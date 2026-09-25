import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG } from '../infra/infra.module';
import { one, q } from '../infra/pg.provider';

// Same fixes the worker applies with autoFix (worker/src/spatial/topology_fabric.py APPLY_SQL).
const APPLY: Record<string, string> = {
  clip_from: `UPDATE source_features t SET geom = ST_CollectionExtract(ST_MakeValid(ST_Difference(t.geom, k.geom)), 3)
              FROM source_features k WHERE t.id = $1 AND k.id = $2`,
  merge_into: `UPDATE source_features t SET geom = ST_CollectionExtract(ST_MakeValid(ST_Union(t.geom, $2::geometry)), 3)
               WHERE t.id = $1`,
  remove_repeated_points: `UPDATE source_features t SET geom = ST_RemoveRepeatedPoints(t.geom, $2::float8) WHERE t.id = $1`,
};

@Injectable()
export class TopologyService {
  constructor(@Inject(PG) private pg: Pool) {}

  issues(f: { wardId?: string; sourceId?: string; status?: string; type?: string }) {
    const where: string[] = []; const params: unknown[] = [];
    for (const [col, val] of [['i.ward_id', f.wardId], ['i.source_id', f.sourceId], ['i.status', f.status], ['i.issue_type', f.type]] as const)
      if (val) { params.push(val); where.push(`${col} = $${params.length}`); }
    return q(this.pg, `
      SELECT i.id, i.ward_id, i.source_id, s.type AS source_type, s.original_name AS source_name, i.issue_type,
             i.area_sqm, i.feature_ids, i.status, i.fix, i.resolved_by, i.resolved_at, i.created_at,
             ST_AsGeoJSON(i.geom)::json AS geometry, ST_AsGeoJSON(i.fixed_geom)::json AS fixed_geometry
      FROM topology_issues i JOIN data_sources s ON s.id = i.source_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY array_position(ARRAY['overlap','gap','sliver','duplicate_vertex','self_intersection'], i.issue_type),
               i.area_sqm DESC NULLS LAST
      LIMIT 5000`,
      params);
  }

  private async applyFix(c: PoolClient, issue: any) {
    const fix = issue.fix ?? {};
    const sql = APPLY[fix.action];
    if (!sql) throw new BadRequestException(`issue has no applicable fix (${fix.action ?? 'none'})`);
    const arg = fix.action === 'clip_from' ? fix.keep : fix.action === 'merge_into' ? issue.geom : fix.tolerance_deg;
    await c.query(sql, [fix.target, arg]);
    const { rows } = await c.query(`SELECT geom FROM source_features WHERE id = $1`, [fix.target]);
    return rows[0]?.geom ?? null;
  }

  async resolve(id: string, action: string, by: string) {
    const client = await this.pg.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT *, geom::text AS geom FROM topology_issues WHERE id = $1 FOR UPDATE`, [id]);
      const issue = rows[0];
      if (!issue) throw new NotFoundException('Topology issue not found');
      let status = issue.status;
      if (action === 'accept_fix') {
        if (issue.status !== 'open') throw new BadRequestException(`issue is already ${issue.status}`);
        const fixed = await this.applyFix(client, issue);
        await client.query(`UPDATE topology_issues SET fixed_geom = $2 WHERE id = $1`, [id, fixed]);
        status = 'accepted';
      } else if (action === 'ignore') {
        status = 'ignored';
      } else if (action === 'reopen') {
        if (issue.status === 'accepted' || issue.status === 'auto_fixed')
          throw new BadRequestException('an applied fix cannot be reopened; re-run the topology check instead');
        status = 'open';
      }
      await client.query(`UPDATE topology_issues SET status = $2, resolved_by = $3, resolved_at = now() WHERE id = $1`,
                         [id, status, by]);
      await client.query(`INSERT INTO audit_logs (action, entity, detail) VALUES ($1, $2, $3)`,
                         [`topology.${action}`, `topology_issues:${id}`, { issue_type: issue.issue_type, by }]);
      await client.query('COMMIT');
      return { id, status, ward_id: issue.ward_id };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async acceptAll(sourceId: string, by: string) {
    const open = await q(this.pg, `SELECT id FROM topology_issues WHERE source_id = $1 AND status = 'open'
                                   AND fix->>'action' IN ('clip_from','merge_into','remove_repeated_points')`, [sourceId]);
    let accepted = 0; const failed: string[] = [];
    for (const r of open) {
      try { await this.resolve(r.id, 'accept_fix', by); accepted += 1; } catch { failed.push(r.id); }
    }
    const src = await one(this.pg, `SELECT ward_id FROM data_sources WHERE id = $1`, [sourceId]);
    return { accepted, failed, ward_id: src?.ward_id ?? null };
  }
}
