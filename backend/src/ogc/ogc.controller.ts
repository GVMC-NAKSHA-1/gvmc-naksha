import { BadRequestException, Controller, Get, Header, Inject, NotFoundException, Param, Query, Req } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../infra/infra.module';
import { one, q } from '../infra/pg.provider';
import { pageLinks, parseBbox, parsePaging } from './paging';

// OGC API – Features (Part 1: Core, GeoJSON) — a standards-based, read-only exchange surface so
// other departments' GIS (QGIS, ArcGIS, GDAL `OAPIF:` driver) can consume harmonized land data.

type Collection = { id: string; title: string; description: string; table: string; geom: string; props: string; where?: string };

const STATIC: Collection[] = [
  { id: 'harmonized-parcels', title: 'Harmonized parcels (golden records)', table: 'harmonized_parcels', geom: 'geom',
    description: 'One record per parcel after multi-source harmonization, with attribute provenance and confidence.',
    props: `attributes || jsonb_build_object('ward_id', ward_id, 'confidence', confidence, 'conflict_count', conflict_count,
             'geometry_source', geom_source_type, 'provenance', attribute_provenance, 'assembled_at', assembled_at)` },
  { id: 'change-detections', title: 'Structural change detections', table: 'change_detections', geom: 'geom',
    description: 'New, demolished, extended and vertically extended structures between survey epochs.',
    props: `jsonb_build_object('ward_id', ward_id, 'change_type', change_type, 'area_before', area_before, 'area_after', area_after,
             'height_before', height_before, 'height_after', height_after, 'confidence', confidence, 'status', status)` },
  { id: 'topology-issues', title: 'Topology issues', table: 'topology_issues', geom: 'geom',
    description: 'Overlaps, gaps and slivers found in parcel fabrics, with their resolution status.',
    props: `jsonb_build_object('ward_id', ward_id, 'issue_type', issue_type, 'area_sqm', area_sqm, 'status', status)` },
  { id: 'sync-findings', title: 'AI ↔ cadastre synchronisation findings', table: 'sync_findings', geom: 'geom',
    description: 'Unregistered structures, encroachments, vacant parcels and attribute drift.',
    props: `detail || jsonb_build_object('ward_id', ward_id, 'finding_type', finding_type)` },
];

@Controller('ogc')
export class OgcController {
  constructor(@Inject(PG) private pg: Pool) {}

  private base(req: any) {
    return `${req.protocol}://${req.get('host')}/api/ogc`;
  }

  private async collection(id: string): Promise<Collection> {
    const c = STATIC.find((x) => x.id === id);
    if (c) return c;
    const m = /^source-([0-9a-f-]{36})$/.exec(id);
    if (m) {
      const src = await one(this.pg, `SELECT id, type, original_name FROM data_sources WHERE id = $1`, [m[1]]);
      if (src)
        return { id, title: `${src.type}: ${src.original_name ?? src.id}`, description: 'Normalised source features (WGS84).',
                 table: 'source_features', geom: 'geom', props: 'properties', where: `source_id = '${src.id}'` };
    }
    throw new NotFoundException(`collection ${id} not found`);
  }

  private meta(c: Collection, base: string) {
    return {
      id: c.id, title: c.title, description: c.description, itemType: 'feature',
      crs: ['http://www.opengis.net/def/crs/OGC/1.3/CRS84'],
      links: [{ rel: 'items', type: 'application/geo+json', title: 'Items', href: `${base}/collections/${c.id}/items` }],
    };
  }

  @Get()
  landing(@Req() req: any) {
    const b = this.base(req);
    return {
      title: 'NAKSHA land-record integration — OGC API Features',
      description: 'Harmonized, validated multi-source land data for inter-departmental exchange.',
      links: [
        { rel: 'self', type: 'application/json', href: b },
        { rel: 'conformance', type: 'application/json', href: `${b}/conformance` },
        { rel: 'data', type: 'application/json', href: `${b}/collections` },
      ],
    };
  }

  @Get('conformance')
  conformance() {
    return { conformsTo: [
      'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core',
      'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson',
    ] };
  }

  @Get('collections')
  async collections(@Req() req: any) {
    const b = this.base(req);
    const sources = await q(this.pg, `SELECT id FROM data_sources WHERE status = 'ready'
                                      AND type NOT IN ('ori','drone_imagery','dsm_dtm') ORDER BY created_at DESC LIMIT 200`);
    const all = [...STATIC, ...(await Promise.all(sources.map((s: any) => this.collection(`source-${s.id}`))))];
    const counts = await Promise.all(all.map((c) =>
      one(this.pg, `SELECT count(*)::int AS n FROM ${c.table} ${c.where ? 'WHERE ' + c.where : ''}`)));
    return {
      links: [{ rel: 'self', type: 'application/json', href: `${b}/collections` }],
      collections: all.map((c, i) => ({ ...this.meta(c, b), numberOfFeatures: counts[i]?.n ?? 0 })),
    };
  }

  @Get('collections/:id')
  async one(@Param('id') id: string, @Req() req: any) {
    return this.meta(await this.collection(id), this.base(req));
  }

  @Get('collections/:id/items')
  @Header('Content-Type', 'application/geo+json')
  async items(@Param('id') id: string, @Req() req: any, @Query('limit') limit?: string, @Query('offset') offset?: string,
              @Query('bbox') bbox?: string, @Query('wardId') wardId?: string) {
    const c = await this.collection(id);
    const page = parsePaging(limit, offset);
    let box: [number, number, number, number] | null;
    try { box = parseBbox(bbox); } catch (e: any) { throw new BadRequestException(e.message); }
    const where: string[] = c.where ? [c.where] : []; const params: unknown[] = [];
    if (box) { params.push(...box); where.push(`ST_Intersects(${c.geom}, ST_MakeEnvelope($1,$2,$3,$4,4326))`); }
    if (wardId && c.table !== 'source_features') { params.push(wardId); where.push(`ward_id = $${params.length}`); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await one(this.pg, `SELECT count(*)::int AS n FROM ${c.table} ${w}`, params);
    const rows = await q(this.pg, `
      SELECT id, ST_AsGeoJSON(${c.geom})::json AS geometry, ${c.props} AS properties
      FROM ${c.table} ${w} ORDER BY id LIMIT ${page.limit} OFFSET ${page.offset}`, params);
    const matched = total?.n ?? 0;
    return {
      type: 'FeatureCollection',
      features: rows.map((r: any) => ({ type: 'Feature', id: r.id, geometry: r.geometry, properties: r.properties })),
      numberMatched: matched,
      numberReturned: rows.length,
      timeStamp: new Date().toISOString(),
      links: pageLinks(`${this.base(req)}/collections/${id}/items`, { bbox, wardId }, page.limit, page.offset, matched),
    };
  }
}
