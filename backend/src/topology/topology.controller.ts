import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../infra/infra.module';
import { one } from '../infra/pg.provider';
import { Queue } from '../infra/queue.client';
import { Roles } from '../common/roles.decorator';
import { audit } from '../common/audit';
import { ResolveIssueDto, RunTopologyDto } from './dto';
import { TopologyService } from './topology.service';

/** Automated topology correction of parcel fabrics and footprints. */
@Controller('topology')
export class TopologyController {
  constructor(private svc: TopologyService, private queue: Queue, @Inject(PG) private pg: Pool) {}

  @Post('run')
  @Roles('admin', 'analyst')
  @HttpCode(202)
  async run(@Body() dto: RunTopologyDto, @Req() req: any) {
    const src = await one(this.pg, `SELECT id, ward_id FROM data_sources WHERE id = $1`, [dto.sourceId]);
    if (!src) throw new NotFoundException('Source not found');
    const jobId = await this.queue.enqueue('ingest', { jobType: 'FIX_TOPOLOGY', ...dto, wardId: src.ward_id });
    await audit(this.pg, req.user?.id, 'topology.run', `data_sources:${src.id}`, dto);
    return { status: 'processing', jobId };
  }

  @Get('issues')
  issues(@Query('wardId') wardId?: string, @Query('sourceId') sourceId?: string,
         @Query('status') status?: string, @Query('type') type?: string) {
    return this.svc.issues({ wardId, sourceId, status, type });
  }

  @Post('issues/:id/resolve')
  @Roles('admin', 'analyst', 'official')
  async resolve(@Param('id') id: string, @Body() dto: ResolveIssueDto, @Req() req: any) {
    const res = await this.svc.resolve(id, dto.action, req.user?.email ?? 'officer');
    if (dto.action === 'accept_fix' && res.ward_id)
      await this.queue.enqueue('ingest', { jobType: 'HARMONIZE_WARD', wardId: res.ward_id });
    return res;
  }

  @Post('sources/:sourceId/accept-all')
  @Roles('admin', 'analyst')
  async acceptAll(@Param('sourceId') sourceId: string, @Req() req: any) {
    const res = await this.svc.acceptAll(sourceId, req.user?.email ?? 'officer');
    if (res.accepted && res.ward_id) await this.queue.enqueue('ingest', { jobType: 'HARMONIZE_WARD', wardId: res.ward_id });
    return res;
  }
}
