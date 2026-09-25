import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../infra/infra.module';
import { q, one } from '../infra/pg.provider';
import { R2 } from '../infra/r2.client';
import { Queue } from '../infra/queue.client';
import { classifyReadiness, summarizeReadiness } from './readiness';

// A ward holds a few thousand golden records; "all wards" is capped so one request cannot pull
// the whole city into the browser. Exports (GeoJSON / GeoPackage / OGC paging) are not capped.
const LIST_LIMIT = 5000;

@Injectable()
export class HarmonizedService {
  constructor(@Inject(PG) private pg: Pool, private r2: R2, private queue: Queue) {}

  enqueueAssemble(wardId: string) {
    return this.queue.enqueue('ingest', { jobType: 'ASSEMBLE_WARD', wardId });
  }

  list(wardId: string | undefined, minConfidence: number) {
    const min = Number.isFinite(minConfidence) ? minConfidence / 100 : 0;
    const where: string[] = ['COALESCE(confidence, 0) >= $1'];
    const params: unknown[] = [min];
    if (wardId) {
      params.push(wardId);
      where.push(`ward_id = $${params.length}`);
    }
    return q(this.pg, `
      SELECT id, ward_id, geom_source_type, attributes, confidence, conflict_count,
             array_length(member_feature_ids, 1) AS member_count, assembled_at
      FROM harmonized_parcels
      WHERE ${where.join(' AND ')}
      ORDER BY confidence DESC NULLS LAST
      LIMIT ${LIST_LIMIT}`, params);
  }

  /** Cadastral finalisation readiness: no open conflicts, no open topology issues, confidence ≥ 0.85. */
  async readiness(wardId?: string) {
    const rows = await q(this.pg, `
      SELECT h.id, h.ward_id, h.confidence, h.conflict_count,
             (SELECT count(*)::int FROM topology_issues t
               WHERE t.status = 'open' AND t.feature_ids && h.member_feature_ids) AS topology_open
      FROM harmonized_parcels h ${wardId ? 'WHERE h.ward_id = $1' : ''}`, wardId ? [wardId] : []);
    // The summary counts every record; the drill-down list is capped, blocked records first.
    const parcels = rows.map((r: any) => ({ id: r.id, ward_id: r.ward_id, confidence: r.confidence, conflict_count: r.conflict_count,
                                            topology_open: r.topology_open, readiness: classifyReadiness(r) }));
    parcels.sort((a: any, b: any) => Number(a.readiness === 'ready') - Number(b.readiness === 'ready'));
    return { ...summarizeReadiness(rows), parcels: parcels.slice(0, LIST_LIMIT) };
  }

  async detail(id: string) {
    const row = await one(this.pg, `
      SELECT h.*, ST_AsGeoJSON(h.geom)::json AS geometry
      FROM harmonized_parcels h WHERE h.id = $1`, [id]);
    if (!row) throw new NotFoundException('Harmonized parcel not found');
    return row;
  }

  // Synchronous GeoJSON build. With R2 configured -> upload + presigned URL (same pattern as
  // ExportService.exportCsv). Without R2 keys -> return the FeatureCollection inline so the
  // export still works for the keyless demo.
  async exportGeojson(wardId: string) {
    const rows = await q(this.pg, `
      SELECT id, ST_AsGeoJSON(geom)::json AS geometry, attributes, attribute_provenance,
             confidence, conflict_count
      FROM harmonized_parcels WHERE ward_id = $1`, [wardId]);
    if (!rows.length)
      throw new BadRequestException('No harmonized parcels — run POST /api/harmonized/assemble first');

    const fc = {
      type: 'FeatureCollection',
      features: rows.map((r: any) => ({
        type: 'Feature',
        id: r.id,
        geometry: r.geometry,
        properties: {
          ...r.attributes,
          _provenance: r.attribute_provenance,
          _confidence: r.confidence,
          _conflict_count: r.conflict_count,
        },
      })),
    };

    // No R2 bucket configured -> return the FeatureCollection inline (keyless demo).
    if (!process.env.R2_BUCKET_NAME) {
      return { feature_count: rows.length, format: 'geojson', geojson: fc };
    }
    try {
      const key = `exports/harmonized/${wardId}_${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}.geojson`;
      await this.r2.putObject(key, JSON.stringify(fc), 'application/geo+json');
      await this.pg.query(`
        INSERT INTO harmonized_exports (ward_id, format, r2_key, feature_count, status)
        VALUES ($1, 'geojson', $2, $3, 'ready')`, [wardId, key, rows.length]);
      return { presigned_url: await this.r2.presignGet(key), feature_count: rows.length, format: 'geojson' };
    } catch {
      // R2 misconfigured / unreachable -> still hand back the data.
      return { feature_count: rows.length, format: 'geojson', geojson: fc };
    }
  }

  async enqueueGpkgExport(wardId: string) {
    const row = await one(this.pg, `
      INSERT INTO harmonized_exports (ward_id, format, status)
      VALUES ($1, 'gpkg', 'processing') RETURNING id`, [wardId]);
    const jobId = await this.queue.enqueue('ingest', {
      jobType: 'EXPORT_HARMONIZED', wardId, exportId: row.id, format: 'gpkg',
    });
    return { status: 'processing', exportId: row.id, jobId };
  }

  async listExports(wardId: string) {
    const rows = await q(this.pg, `
      SELECT id, format, status, feature_count, error, created_at, r2_key
      FROM harmonized_exports WHERE ward_id = $1 ORDER BY created_at DESC`, [wardId]);
    return Promise.all(rows.map(async (r: any) => ({
      id: r.id,
      format: r.format,
      status: r.status,
      feature_count: r.feature_count,
      error: r.error,
      created_at: r.created_at,
      download_url: r.status === 'ready' && r.r2_key ? await this.r2.presignGet(r.r2_key) : null,
    })));
  }
}
