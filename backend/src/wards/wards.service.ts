import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../infra/infra.module';
import { q, one } from '../infra/pg.provider';
import { R2 } from '../infra/r2.client';
import { UnassessedQueryDto } from './dto';

@Injectable()
export class WardsService {
  constructor(@Inject(PG) private pg: Pool, private r2: R2) {}

  async listWards() {
    return q(this.pg, `
      SELECT w.id, w.name, w.bbox_north, w.bbox_south, w.bbox_east, w.bbox_west, w.geojson_r2,
             COUNT(p.id)::int AS detection_count
      FROM wards w LEFT JOIN properties p ON p.ward_id = w.id
      GROUP BY w.id
      ORDER BY (substring(w.id FROM '^[0-9]+'))::int NULLS LAST, w.id`)
      .then(rows => rows.map(r => ({ ...r,
        bbox: { north: +r.bbox_north || 0, south: +r.bbox_south || 0, east: +r.bbox_east || 0, west: +r.bbox_west || 0 } })));
  }

  async getChanges(wardId: string) {
    const row = await one(this.pg, `SELECT geojson_r2 FROM wards WHERE id = $1`, [wardId]);
    if (!row?.geojson_r2) throw new NotFoundException('No GeoJSON found for this ward');
    return { presigned_url: await this.r2.presignGet(row.geojson_r2) };
  }

  async getUnassessed(wardId: string, f: UnassessedQueryDto) {
    const where = ['p.ward_id = $1']; const params: unknown[] = [wardId];
    if (f.type)   { params.push(f.type);   where.push(`p.detection_type = $${params.length}`); }
    if (f.status) { params.push(f.status); where.push(`p.status = $${params.length}`); }
    return q(this.pg, `
      SELECT p.id, p.ward_id, w.name AS ward_name, p.lat, p.lng, p.area_sqm, p.detection_type,
             p.confidence, p.confidence_breakdown, p.detected_at, p.geojson_r2, p.status, p.ai_explanation
      FROM properties p JOIN wards w ON w.id = p.ward_id
      WHERE ${where.join(' AND ')} ORDER BY p.confidence DESC`, params);
  }

  async getAlerts(wardId: string) {
    return q(this.pg, `SELECT id, severity, text, ward_id, created_at FROM alerts
                       WHERE ward_id = $1 ORDER BY created_at DESC`, [wardId]);
  }

  async getWardGeoJSON(wardId: string) {
    const rows = await q(this.pg, `
      SELECT sf.id, ST_AsGeoJSON(sf.geom)::json AS geometry, sf.properties
      FROM source_features sf JOIN data_sources ds ON ds.id = sf.source_id
      WHERE ds.ward_id = $1`, [wardId]);
    return { type: 'FeatureCollection',
             features: rows.map(r => ({ type: 'Feature', id: r.id, geometry: r.geometry, properties: r.properties })) };
  }
}
