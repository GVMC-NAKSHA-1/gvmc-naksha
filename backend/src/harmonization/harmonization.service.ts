import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../infra/infra.module';
import { q, one } from '../infra/pg.provider';
import { Queue } from '../infra/queue.client';
import { FieldMapping } from '../llm/llm.service';

@Injectable()
export class HarmonizationService {
  constructor(@Inject(PG) private pg: Pool, private queue: Queue) {}

  enqueueBatch(wardId: string) {
    return this.queue.enqueue('ingest', { jobType: 'HARMONIZE_WARD', wardId });
  }

  listMatches(wardId: string | undefined, minScore: number) {
    const where: string[] = ['match_score >= $1']; const params: unknown[] = [minScore];
    if (wardId) { params.push(wardId); where.push(`ward_id = $${params.length}`); }
    // ml_features (~30 numbers per match) is only needed by the detail view and label snapshots.
    return q(this.pg, `
      SELECT id, ward_id, feature_a_id, feature_b_id, source_a_type, source_b_type, geometry_iou,
             centroid_distance_m, match_score, confidence_breakdown - 'ml_features' AS confidence_breakdown, matched_at
      FROM matches WHERE ${where.join(' AND ')} ORDER BY match_score DESC LIMIT 5000`, params);
  }

  async matchDetail(id: string) {
    const row = await one(this.pg, `
      SELECT m.*, l.label AS officer_label, l.labelled_by, l.labelled_at,
             ST_AsGeoJSON(fa.geom)::json AS feature_a_geom, fa.properties AS feature_a_props,
             ST_AsGeoJSON(fb.geom)::json AS feature_b_geom, fb.properties AS feature_b_props
      FROM matches m
      JOIN source_features fa ON fa.id = m.feature_a_id
      JOIN source_features fb ON fb.id = m.feature_b_id
      LEFT JOIN match_labels l ON l.feature_a_id = m.feature_a_id AND l.feature_b_id = m.feature_b_id
      WHERE m.id = $1`, [id]);
    if (!row) throw new NotFoundException('Match not found');
    return row;
  }

  /**
   * Officer confirms or rejects a match → a training label for the ML matcher (match_labels, with the
   * feature snapshot the worker stored). A rejected match is removed now (its conflicts cascade) and
   * the ward re-matched, so the feature can pair with its right partner; match.py never proposes it again.
   */
  async labelMatch(id: string, label: boolean, by: string) {
    const row = await one(this.pg, `
      INSERT INTO match_labels (ward_id, feature_a_id, feature_b_id, source_a_type, source_b_type, label,
                                features, match_score, model_version, labelled_by)
      SELECT ward_id, feature_a_id, feature_b_id, source_a_type, source_b_type, $2,
             COALESCE(confidence_breakdown->'ml_features', '{}'::jsonb), match_score,
             confidence_breakdown->>'model_version', $3
      FROM matches WHERE id = $1
      ON CONFLICT (feature_a_id, feature_b_id) DO UPDATE SET
        label = EXCLUDED.label, labelled_by = EXCLUDED.labelled_by, labelled_at = now()
      RETURNING id, ward_id, label, labelled_by, labelled_at`, [id, label, by]);
    if (!row) throw new NotFoundException('Match not found');
    if (!label) {
      await this.pg.query(`DELETE FROM matches WHERE id = $1`, [id]);
      await this.enqueueBatch(row.ward_id);
    }
    return row;
  }

  enqueueRetrain(force: boolean) {
    return this.queue.enqueue('ingest', { jobType: 'RETRAIN_MATCHER', force });
  }

  async persistMappings(a: string, b: string, mappings: FieldMapping[]) {
    for (const m of mappings)
      await this.pg.query(`
        INSERT INTO schema_mappings (source_a_id, source_b_id, field_a, field_b, confidence, rationale)
        VALUES ($1,$2,$3,$4,$5,$6)`, [a, b, m.field_a, m.field_b, m.confidence, m.rationale]);
  }

  listMappings(a?: string, b?: string) {
    const where: string[] = []; const params: unknown[] = [];
    if (a) { params.push(a); where.push(`source_a_id = $${params.length}`); }
    if (b) { params.push(b); where.push(`source_b_id = $${params.length}`); }
    return q(this.pg, `SELECT * FROM schema_mappings ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                       ORDER BY confidence DESC`, params);
  }
}
