import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import { IsString } from 'class-validator';
import { Pool } from 'pg';
import { PG } from '../infra/infra.module';
import { q } from '../infra/pg.provider';
import { Queue } from '../infra/queue.client';
import { Roles } from '../common/roles.decorator';
import { audit } from '../common/audit';

export class RunValidationDto { @IsString() wardId!: string; }

/** Data-quality validation and AI ↔ cadastre synchronisation findings. */
@Controller('validation')
export class ValidationController {
  constructor(@Inject(PG) private pg: Pool, private queue: Queue) {}

  @Post('run')
  @Roles('admin', 'analyst')
  @HttpCode(202)
  async run(@Body() dto: RunValidationDto, @Req() req: any) {
    const jobId = await this.queue.enqueue('ingest', { jobType: 'VALIDATE_WARD', wardId: dto.wardId });
    await audit(this.pg, req.user?.id, 'validation.run', `wards:${dto.wardId}`, {});
    return { status: 'processing', jobId };
  }

  /** Latest report per source plus the latest ward-level summary (source_id = null). */
  @Get('reports')
  reports(@Query('wardId') wardId?: string) {
    return q(this.pg, `
      SELECT DISTINCT ON (r.ward_id, r.source_id) r.id, r.ward_id, r.source_id, r.score, r.checks, r.created_at,
             s.type AS source_type, s.original_name AS source_name
      FROM validation_reports r LEFT JOIN data_sources s ON s.id = r.source_id
      ${wardId ? 'WHERE r.ward_id = $1' : ''}
      ORDER BY r.ward_id, r.source_id NULLS FIRST, r.created_at DESC`, wardId ? [wardId] : []);
  }

  /** Score history of the ward summary (trend chart). */
  @Get('history')
  history(@Query('wardId') wardId: string) {
    return q(this.pg, `SELECT score, created_at FROM validation_reports WHERE ward_id = $1 AND source_id IS NULL
                       ORDER BY created_at DESC LIMIT 30`, [wardId]);
  }

  @Get('findings')
  async findings(@Query('wardId') wardId?: string, @Query('type') type?: string) {
    const where: string[] = []; const params: unknown[] = [];
    if (wardId) { params.push(wardId); where.push(`ward_id = $${params.length}`); }
    if (type) { params.push(type); where.push(`finding_type = $${params.length}`); }
    const rows = await q(this.pg, `
      SELECT id, ward_id, finding_type, feature_ids, detail, created_at, ST_AsGeoJSON(geom)::json AS geometry
      FROM sync_findings ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY finding_type, created_at DESC LIMIT 5000`, params);
    return {
      type: 'FeatureCollection',
      features: rows.map((r: any) => ({
        type: 'Feature', id: r.id, geometry: r.geometry,
        properties: { finding_type: r.finding_type, ward_id: r.ward_id, feature_ids: r.feature_ids, ...r.detail, created_at: r.created_at },
      })),
    };
  }
}
