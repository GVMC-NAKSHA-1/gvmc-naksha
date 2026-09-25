import { Controller, Get, Inject, Query } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../infra/infra.module';
import { q } from '../infra/pg.provider';

/** Governance trail: who changed what (conflict decisions, verifications, topology fixes, georef…). */
@Controller('audit')
export class AuditController {
  constructor(@Inject(PG) private pg: Pool) {}

  @Get()
  list(@Query('entity') entity?: string, @Query('action') action?: string, @Query('limit') limit = '100') {
    const where: string[] = []; const params: unknown[] = [];
    if (entity) { params.push(`${entity}%`); where.push(`entity LIKE $${params.length}`); }
    if (action) { params.push(`${action}%`); where.push(`action LIKE $${params.length}`); }
    params.push(Math.min(500, Math.max(1, Number(limit) || 100)));
    return q(this.pg, `
      SELECT a.id, a.actor, p.email AS actor_email, a.action, a.entity, a.detail, a.created_at
      FROM audit_logs a LEFT JOIN profiles p ON p.id = a.actor
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.created_at DESC LIMIT $${params.length}`, params);
  }
}
