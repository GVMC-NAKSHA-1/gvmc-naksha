import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { Pool } from 'pg';
import { PG } from '../infra/infra.module';
import { one, q } from '../infra/pg.provider';
import { Queue } from '../infra/queue.client';
import { Roles } from '../common/roles.decorator';
import { audit } from '../common/audit';

export class RunChangesDto {
  @IsString() wardId!: string;
  @IsUUID() baselineSourceId!: string;
  @IsUUID() currentSourceId!: string;
  @IsOptional() @IsObject() params?: Record<string, number>;
}
export class VerifyChangeDto {
  @IsIn(['pending', 'confirmed', 'false_positive']) status!: string;
}

const STRUCTURES = ['building_footprint', 'ai_extracted', 'cadastral', 'municipal_gis'];
const PARAM_KEYS = ['minOverlap', 'areaChangePct', 'heightChangeM', 'minAreaSqm'];

/** Multi-epoch change detection between two structure layers (survey vs AI extraction). */
@Controller('changes')
export class ChangesController {
  constructor(@Inject(PG) private pg: Pool, private queue: Queue) {}

  @Post('run')
  @Roles('admin', 'analyst')
  @HttpCode(202)
  async run(@Body() dto: RunChangesDto, @Req() req: any) {
    if (dto.baselineSourceId === dto.currentSourceId) throw new BadRequestException('choose two different sources');
    const srcs = await q(this.pg, `SELECT id, type, ward_id FROM data_sources WHERE id = ANY($1::uuid[])`,
                         [[dto.baselineSourceId, dto.currentSourceId]]);
    if (srcs.length !== 2) throw new NotFoundException('Source not found');
    if (srcs.some((s: any) => !STRUCTURES.includes(s.type)))
      throw new BadRequestException('compare polygon layers (footprints, AI extraction, cadastral)');
    const params = Object.fromEntries(Object.entries(dto.params ?? {})
      .filter(([k, v]) => PARAM_KEYS.includes(k) && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]));
    const run = await one(this.pg, `
      INSERT INTO change_runs (ward_id, baseline_source_id, current_source_id, params) VALUES ($1,$2,$3,$4) RETURNING *`,
      [dto.wardId, dto.baselineSourceId, dto.currentSourceId, params]);
    const jobId = await this.queue.enqueue('ingest', { jobType: 'DETECT_CHANGES', runId: run.id, wardId: dto.wardId });
    await audit(this.pg, req.user?.id, 'changes.run', `change_runs:${run.id}`, { ...dto, params });
    return { run, jobId };
  }

  @Get('runs')
  runs(@Query('wardId') wardId?: string) {
    return q(this.pg, `
      SELECT r.*, b.original_name AS baseline_name, b.captured_at AS baseline_captured,
             c.original_name AS current_name, c.captured_at AS current_captured
      FROM change_runs r JOIN data_sources b ON b.id = r.baseline_source_id JOIN data_sources c ON c.id = r.current_source_id
      ${wardId ? 'WHERE r.ward_id = $1' : ''} ORDER BY r.created_at DESC LIMIT 50`, wardId ? [wardId] : []);
  }

  @Get()
  list(@Query('runId') runId?: string, @Query('wardId') wardId?: string,
       @Query('type') type?: string, @Query('status') status?: string) {
    const where: string[] = []; const params: unknown[] = [];
    for (const [col, val] of [['run_id', runId], ['ward_id', wardId], ['change_type', type], ['status', status]] as const)
      if (val) { params.push(val); where.push(`${col} = $${params.length}`); }
    return q(this.pg, `
      SELECT id, run_id, ward_id, change_type, area_before, area_after, height_before, height_after, confidence,
             status, verified_by, verified_at, created_at,
             ST_AsGeoJSON(geom)::json AS geometry, ST_AsGeoJSON(geom_before)::json AS geometry_before
      FROM change_detections ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY confidence DESC LIMIT 2000`, params);
  }

  @Post(':id/verify')
  @Roles('official', 'admin', 'analyst')
  async verify(@Param('id') id: string, @Body() dto: VerifyChangeDto, @Req() req: any) {
    const row = await one(this.pg, `
      UPDATE change_detections SET status = $2, verified_by = $3, verified_at = now() WHERE id = $1 RETURNING id, status`,
      [id, dto.status, req.user?.email ?? 'officer']);
    if (!row) throw new NotFoundException('Change not found');
    await audit(this.pg, req.user?.id, 'changes.verify', `change_detections:${id}`, dto);
    return row;
  }
}
