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
    return q(this.pg, `SELECT * FROM matches WHERE ${where.join(' AND ')} ORDER BY match_score DESC LIMIT 5000`, params);
  }

  async matchDetail(id: string) {
    const row = await one(this.pg, `
      SELECT m.*,
             ST_AsGeoJSON(fa.geom)::json AS feature_a_geom, fa.properties AS feature_a_props,
             ST_AsGeoJSON(fb.geom)::json AS feature_b_geom, fb.properties AS feature_b_props
      FROM matches m
      JOIN source_features fa ON fa.id = m.feature_a_id
      JOIN source_features fb ON fb.id = m.feature_b_id
      WHERE m.id = $1`, [id]);
    if (!row) throw new NotFoundException('Match not found');
    return row;
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
