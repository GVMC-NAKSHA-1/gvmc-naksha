import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../infra/infra.module';
import { q } from '../infra/pg.provider';

const TTL_MS = 60 * 60 * 1000;   // the table only changes when `load-villages` runs

@Injectable()
export class VillagesService {
  private cache: { at: number; fc: unknown } | null = null;

  constructor(@Inject(PG) private pg: Pool) {}

  /** Every Survey of India village (migration 0018), simplified for an overview map (~660 KB). */
  async listAll() {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.fc;
    const rows = await q(this.pg, `
      SELECT soi_objectid AS id, name, category, mandal, district, vill_lgd, mandal_lgd,
             vill_lgd = '802947' AS is_gvmc,
             ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0002), 5)::json AS geometry
      FROM villages ORDER BY district, mandal, name`);
    const fc = { type: 'FeatureCollection',
                 features: rows.map(({ id, geometry, ...properties }) => ({ type: 'Feature', id, geometry, properties })) };
    this.cache = { at: Date.now(), fc };
    return fc;
  }
}
