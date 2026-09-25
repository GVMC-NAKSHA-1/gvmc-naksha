import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../infra/infra.module';
import { q, one } from '../infra/pg.provider';
import { ListConflictsDto } from './dto';

@Injectable()
export class ConflictsService {
  private static readonly VALID = new Set(['pending', 'resolved', 'needs_review', 'rejected']);
  constructor(@Inject(PG) private pg: Pool) {}

  list(f: ListConflictsDto) {
    const where: string[] = []; const params: unknown[] = [];
    for (const [col, val] of [['ward_id', f.wardId], ['status', f.status], ['severity', f.severity]] as const)
      if (val) { params.push(val); where.push(`${col} = $${params.length}`); }
    return q(this.pg, `SELECT * FROM conflicts ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                       ORDER BY array_position(ARRAY['critical','high','medium','low']::text[], severity::text),
                                created_at DESC
                       LIMIT 5000`, params);
  }

  async get(id: string) {
    const row = await one(this.pg, `
      SELECT c.*, row_to_json(m.*) AS match FROM conflicts c
      LEFT JOIN matches m ON m.id = c.match_id WHERE c.id = $1`, [id]);
    if (!row) throw new NotFoundException('Conflict not found');
    return row;
  }

  async resolve(id: string, dto: { status: string; notes?: string; resolvedBy?: string }) {
    if (!ConflictsService.VALID.has(dto.status))
      throw new BadRequestException(`status must be one of: ${[...ConflictsService.VALID].join(', ')}`);
    const { rowCount } = await this.pg.query(`
      UPDATE conflicts SET status=$1, notes=COALESCE($2, notes), resolved_by=$3, resolved_at=now()
      WHERE id=$4`, [dto.status, dto.notes ?? null, dto.resolvedBy ?? 'official', id]);
    if (!rowCount) throw new NotFoundException('Conflict not found');
    await this.pg.query(`INSERT INTO audit_logs (action, entity, detail) VALUES ('conflict.resolve', $1, $2)`,
                        [`conflicts:${id}`, dto]);
    return { status: dto.status };
  }
}
