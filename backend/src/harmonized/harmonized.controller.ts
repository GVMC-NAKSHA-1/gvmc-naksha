import {
  BadRequestException, Controller, Get, HttpCode, Inject, Param, Post, Query, Res,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../infra/infra.module';
import { q } from '../infra/pg.provider';
import { Roles } from '../common/roles.decorator';
import { HarmonizedService } from './harmonized.service';

@Controller('harmonized')
export class HarmonizedController {
  constructor(private readonly svc: HarmonizedService, @Inject(PG) private pg: Pool) {}

  @Post('assemble')
  @Roles('admin', 'analyst')
  @HttpCode(202)
  async assemble(@Query('wardId') wardId?: string) {
    const wards = wardId ? [wardId] : (await q(this.pg, `SELECT id FROM wards`)).map((r: any) => r.id);
    const jobs = await Promise.all(wards.map((w: string) => this.svc.enqueueAssemble(w)));
    return { status: 'processing', jobs };
  }

  @Get()
  list(@Query('wardId') wardId?: string, @Query('minConfidence') minConfidence = '0') {
    return this.svc.list(wardId, Number(minConfidence));
  }

  // static routes must be declared before ':id'
  @Get('exports')
  @Roles('official', 'admin')
  listExports(@Query('wardId') wardId: string) {
    if (!wardId) throw new BadRequestException('wardId is required');
    return this.svc.listExports(wardId);
  }

  @Get('export')
  @Roles('official', 'admin')
  async export(
    @Query('wardId') wardId: string,
    @Query('format') format = 'geojson',
    @Res({ passthrough: true }) res: any,
  ) {
    if (!wardId) throw new BadRequestException('wardId is required');
    if (format !== 'geojson' && format !== 'gpkg')
      throw new BadRequestException("format must be 'geojson' or 'gpkg'");
    if (format === 'gpkg') {
      res.status(202);
      return this.svc.enqueueGpkgExport(wardId);
    }
    return this.svc.exportGeojson(wardId);
  }

  @Get('readiness')
  readiness(@Query('wardId') wardId?: string) {
    return this.svc.readiness(wardId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.detail(id);
  }
}
