import { BadRequestException, Body, Controller, HttpCode, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { Pool } from 'pg';
import { PG } from '../infra/infra.module';
import { one } from '../infra/pg.provider';
import { Queue } from '../infra/queue.client';
import { Roles } from '../common/roles.decorator';
import { audit } from '../common/audit';
import { CRS_LIST, isGeographic } from '../crs/crs';
import { Gcp, MIN_GCPS, solveTransform, toMetres, TransformKind } from './affine';

export class GeorefDto {
  @IsArray() gcps!: Gcp[];
  @IsOptional() @IsIn(['affine', 'poly2']) kind?: TransformKind;
  @IsOptional() @IsString() crs?: string;
}

function validGcps(gcps: unknown): Gcp[] {
  if (!Array.isArray(gcps)) throw new BadRequestException('gcps must be an array');
  return gcps.map((g: any, i) => {
    const v = { px: Number(g?.px), py: Number(g?.py), x: Number(g?.x), y: Number(g?.y) };
    if (!Object.values(v).every(Number.isFinite)) throw new BadRequestException(`gcp #${i + 1} needs numeric px, py, x, y`);
    return v;
  });
}

/** Geo-referencing engine for scans / rasters without a CRS (ground control points). */
@Controller('georef')
export class GeorefController {
  constructor(@Inject(PG) private pg: Pool, private queue: Queue) {}

  /** Instant fit quality while the officer places points: residual per GCP and RMSE (metres). */
  @Post(':sourceId/preview')
  @Roles('admin', 'analyst', 'official')
  preview(@Body() dto: GeorefDto) {
    const kind = dto.kind ?? 'affine';
    const crs = dto.crs ?? 'EPSG:4326';
    const gcps = validGcps(dto.gcps);
    if (gcps.length < MIN_GCPS[kind])
      return { kind, crs, ok: false, needed: MIN_GCPS[kind], residuals_m: [], rmse_m: null };
    try {
      const sol = solveTransform(gcps, kind);
      const geo = isGeographic(crs);
      const lat = gcps.reduce((s, g) => s + g.y, 0) / gcps.length;
      return {
        kind, crs, ok: true, needed: MIN_GCPS[kind],
        residuals_m: sol.residuals.map((r) => Math.round(toMetres(r, geo, lat) * 1000) / 1000),
        rmse_m: Math.round(toMetres(sol.rmse, geo, lat) * 1000) / 1000,
      };
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
  }

  @Post(':sourceId/apply')
  @Roles('admin', 'analyst')
  @HttpCode(202)
  async apply(@Param('sourceId') sourceId: string, @Body() dto: GeorefDto, @Req() req: any) {
    const src = await one(this.pg, `SELECT id, ward_id, status FROM data_sources WHERE id = $1`, [sourceId]);
    if (!src) throw new NotFoundException('Source not found');
    const kind = dto.kind ?? 'affine';
    const crs = dto.crs ?? 'EPSG:4326';
    if (!CRS_LIST.some((c) => c.code === crs)) throw new BadRequestException(`unsupported CRS ${crs}`);
    const gcps = validGcps(dto.gcps);
    try { solveTransform(gcps, kind); } catch (e: any) { throw new BadRequestException(e.message); }
    await this.pg.query(`UPDATE data_sources SET status = 'processing', error = NULL WHERE id = $1`, [sourceId]);
    const jobId = await this.queue.enqueue('ingest', { jobType: 'GEOREFERENCE', sourceId, wardId: src.ward_id, gcps, kind, crs });
    await audit(this.pg, req.user?.id, 'georef.apply', `data_sources:${sourceId}`, { kind, crs, gcp_count: gcps.length });
    return { status: 'processing', jobId };
  }
}
