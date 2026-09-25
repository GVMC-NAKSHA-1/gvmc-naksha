import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../infra/infra.module';
import { one, q } from '../infra/pg.provider';
import { Queue } from '../infra/queue.client';
import { Roles } from '../common/roles.decorator';
import { audit } from '../common/audit';
import { RunExtractionDto } from './dto';

const RASTER_TYPES = ['ori', 'drone_imagery', 'dsm_dtm'];
const PARAM_KEYS = ['min_height_m', 'min_area_sqm', 'simplify_m', 'ground_window_m', 'prob_threshold'];

/** GeoAI building-footprint extraction from drone / ORI / DSM-DTM rasters. */
@Controller('extraction')
export class ExtractionController {
  constructor(@Inject(PG) private pg: Pool, private queue: Queue) {}

  @Post('run')
  @Roles('admin', 'analyst')
  @HttpCode(202)
  async run(@Body() dto: RunExtractionDto, @Req() req: any) {
    const src = await one(this.pg, `SELECT id, type, ward_id, status FROM data_sources WHERE id = $1`, [dto.sourceId]);
    if (!src) throw new NotFoundException('Source not found');
    if (!RASTER_TYPES.includes(src.type)) throw new BadRequestException('Extraction runs on drone imagery, ORI or DSM/DTM sources');
    if (src.status !== 'ready') throw new BadRequestException(`Source is ${src.status}; it must be ready (georeferenced) first`);
    const params = Object.fromEntries(Object.entries(dto.params ?? {})
      .filter(([k, v]) => PARAM_KEYS.includes(k) && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]));
    const run = await one(this.pg, `
      INSERT INTO extraction_runs (ward_id, source_id, method, params) VALUES ($1,$2,$3,$4) RETURNING *`,
      [src.ward_id, src.id, dto.method ?? 'auto', params]);
    const jobId = await this.queue.enqueue('ingest', { jobType: 'EXTRACT_FEATURES', runId: run.id, sourceId: src.id, wardId: src.ward_id });
    await audit(this.pg, req.user?.id, 'extraction.run', `data_sources:${src.id}`, { method: run.method, params });
    return { run, jobId };
  }

  @Get('runs')
  runs(@Query('wardId') wardId?: string) {
    return q(this.pg, `
      SELECT r.*, s.original_name AS source_name, s.type AS source_type
      FROM extraction_runs r JOIN data_sources s ON s.id = r.source_id
      ${wardId ? 'WHERE r.ward_id = $1' : ''} ORDER BY r.created_at DESC LIMIT 100`, wardId ? [wardId] : []);
  }

  @Get('runs/:id')
  async get(@Param('id') id: string) {
    const row = await one(this.pg, `
      SELECT r.*, s.original_name AS source_name, s.type AS source_type
      FROM extraction_runs r JOIN data_sources s ON s.id = r.source_id WHERE r.id = $1`, [id]);
    if (!row) throw new NotFoundException('Extraction run not found');
    return row;
  }
}
