import { Controller, Get, Inject, Query } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../infra/infra.module';
import { q } from '../infra/pg.provider';

/** Live pipeline activity: every job the API or the worker queued, newest first. */
@Controller('jobs')
export class JobsController {
  constructor(@Inject(PG) private pg: Pool) {}

  @Get()
  list(@Query('wardId') wardId?: string, @Query('sourceId') sourceId?: string,
       @Query('status') status?: string, @Query('limit') limit = '50') {
    const where: string[] = []; const params: unknown[] = [];
    for (const [col, val] of [['ward_id', wardId], ['source_id', sourceId], ['status', status]] as const)
      if (val) { params.push(val); where.push(`${col} = $${params.length}`); }
    params.push(Math.min(200, Math.max(1, Number(limit) || 50)));
    return q(this.pg, `
      SELECT id, job_type, ward_id, source_id, status, attempts, result, error, created_at, started_at, finished_at
      FROM pipeline_jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC LIMIT $${params.length}`, params);
  }
}
