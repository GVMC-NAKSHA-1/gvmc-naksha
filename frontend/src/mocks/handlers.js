import { HttpResponse, delay, http } from 'msw';
import {
  CHAT_ANSWERS, CONFLICTS, FEATURES, HARMONIZED, MAPPINGS, MATCHES, PROPERTIES, SOURCES, WARDS,
} from './data';
import { pipelineHandlers } from './pipelineHandlers';

// Mutable in-session copies so uploads / resolutions / verifications persist until reload.
const db = {
  sources: structuredClone(SOURCES),
  features: structuredClone(FEATURES),
  matches: structuredClone(MATCHES),
  conflicts: structuredClone(CONFLICTS),
  harmonized: structuredClone(HARMONIZED),
  mappings: structuredClone(MAPPINGS),
  properties: structuredClone(PROPERTIES),
  exports: [],
  config: { data_mode: 'demo', pipeline_status: 'idle', last_refresh: new Date(Date.now() - 864e5).toISOString(), ndbi_threshold: 0.15 },
};

const wait = (min = 150, max = 600) => delay(min + Math.random() * (max - min));
const q = (request, key) => new URL(request.url).searchParams.get(key);
const notFound = (what) => HttpResponse.json({ message: `${what} not found` }, { status: 404 });
const featureById = (id) => {
  for (const [sourceId, feats] of Object.entries(db.features)) {
    const f = feats.find((x) => x.id === id);
    if (f) return { f, sourceId };
  }
  return null;
};

function computeStats(wardId) {
  const ps = wardId ? db.properties.filter((p) => p.ward_id === String(wardId)) : db.properties;
  return {
    total_detections: ps.length,
    new_builds: ps.filter((p) => p.detection_type === 'new_build').length,
    change_of_use: ps.filter((p) => p.detection_type === 'change_of_use').length,
    pending_verification: ps.filter((p) => p.status === 'pending').length,
    verified: ps.filter((p) => p.status === 'verified').length,
    false_positives: ps.filter((p) => p.status === 'false_positive').length,
    revenue_estimate: 0,
    ward_id: wardId ?? null,
    ...db.config,
  };
}

const harmonizedFC = (wardId) => ({
  type: 'FeatureCollection',
  features: db.harmonized.filter((h) => h.ward_id === wardId).map((h) => ({
    type: 'Feature', id: h.id, geometry: h.geometry,
    properties: { ...h.attributes, _provenance: h.attribute_provenance, _confidence: h.confidence, _conflict_count: h.conflict_count },
  })),
});

const SYNONYMS = {
  khata_no: ['khata_number', 'khata', 'khatha_no'], owner_name: ['owner', 'pattadar', 'owner_nm'], survey_no: ['survey_number', 'sy_no'],
  area_sqm: ['extent_sqyd', 'area', 'extent', 'area_m2'], land_use: ['usage', 'use', 'landuse'], parcel_id: ['parcel', 'pid'],
};
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

export const handlers = [
  // New pipeline endpoints first (e.g. /api/harmonized/readiness must win over /api/harmonized/:id).
  ...pipelineHandlers(db),
  http.get('*/api/health', async () => {
    await wait(80, 200);
    return HttpResponse.json({ status: 'ok', db: 'ok', redis: 'ok', r2: 'ok', ts: new Date().toISOString() });
  }),

  http.get('*/api/wards', async () => {
    await wait();
    return HttpResponse.json(WARDS.map((w) => ({ ...w, geojson_r2: null, detection_count: db.properties.filter((p) => p.ward_id === w.id).length })));
  }),

  // ── Sources ──
  http.get('*/api/sources', async ({ request }) => {
    await wait();
    const wardId = q(request, 'wardId'); const type = q(request, 'type'); const status = q(request, 'status');
    return HttpResponse.json(db.sources
      .filter((s) => (!wardId || s.ward_id === wardId) && (!type || s.type === type) && (!status || s.status === status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }),
  http.get('*/api/sources/:id/features', async ({ params }) => {
    await wait(200, 700);
    const feats = db.features[params.id];
    if (!feats) return notFound('Source');
    return HttpResponse.json({
      type: 'FeatureCollection',
      features: feats.map((f) => ({ ...f, properties: { ...f.properties, _was_invalid: Boolean(f.properties._was_invalid) } })),
    });
  }),
  http.get('*/api/sources/:id', async ({ params }) => {
    await wait();
    const s = db.sources.find((x) => x.id === params.id);
    return s ? HttpResponse.json({ ...s, r2_key: `sources/${s.type}/${s.id}`, download_url: null }) : notFound('Source');
  }),
  http.post('*/api/sources/upload', async ({ request }) => {
    await wait(300, 700);
    const b = await request.json();
    const id = `src-up-${Date.now()}`;
    const src = {
      id, type: b.type, ward_id: b.wardId ?? null, original_name: b.originalName, status: b.scanned ? 'pending_ocr' : 'processing',
      crs: b.crs ?? null, captured_at: b.capturedAt ?? null, scanned: Boolean(b.scanned), created_at: new Date().toISOString(), metadata: {},
    };
    db.sources.unshift(src);
    db.features[id] = [];
    // ETL starts from POST /api/sources/:id/complete once the file is uploaded.
    return HttpResponse.json({ sourceId: id, uploadUrl: '/__mock_upload__', status: src.status, jobId: `job-${id}` }, { status: 202 });
  }),
  http.post('*/api/sources/:id/digitize', async ({ params }) => {
    await wait();
    const s = db.sources.find((x) => x.id === params.id);
    if (!s) return notFound('Source');
    s.status = 'processing';
    setTimeout(() => {
      Object.assign(s, {
        status: 'ready',
        metadata: { ocr: { khata_no: '2207', owner_name: 'Y. Satyanarayana', survey_no: '87/1', area: '1.20 acres' }, ocr_confidence: { khata_no: 88, owner_name: 76, survey_no: 81, area: 64 } },
      });
    }, 3500);
    return HttpResponse.json({ status: 'processing', jobId: `job-ocr-${params.id}` }, { status: 202 });
  }),
  http.put('*/__mock_upload__', async () => { await wait(); return new HttpResponse(null, { status: 200 }); }),

  // ── Harmonization ──
  http.post('*/api/harmonization/run', async ({ request }) => {
    await wait(500, 900);
    const wardId = q(request, 'wardId');
    const wards = wardId ? [wardId] : WARDS.map((w) => w.id);
    db.matches.forEach((m) => { if (wards.includes(m.ward_id)) m.matched_at = new Date().toISOString(); });
    wards.forEach((w, i) => {
      db.track('HARMONIZE_WARD', { wardId: w, ms: 1500 + i * 300, result: { matches: db.matches.filter((m) => m.ward_id === w).length } });
      db.track('DETECT_CONFLICTS', { wardId: w, ms: 2600 + i * 300, result: { conflicts_created: 0 } });
      db.track('ASSEMBLE_WARD', { wardId: w, ms: 3600 + i * 300, result: { harmonized_parcels: db.harmonized.filter((h) => h.ward_id === w).length } });
      db.track('VALIDATE_WARD', { wardId: w, ms: 4600 + i * 300 });
    });
    return HttpResponse.json({ status: 'processing', jobs: wards.map((w) => `job-harmonize-${w}`) }, { status: 202 });
  }),
  http.get('*/api/harmonization/matches/:id', async ({ params }) => {
    await wait();
    const m = db.matches.find((x) => x.id === params.id);
    if (!m) return notFound('Match');
    const a = featureById(m.feature_a_id); const b = featureById(m.feature_b_id);
    const clean = (p) => Object.fromEntries(Object.entries(p ?? {}).filter(([k]) => !k.startsWith('_')));
    return HttpResponse.json({
      ...m,
      feature_a_geom: a?.f.geometry ?? null, feature_a_props: clean(a?.f.properties),
      feature_b_geom: b?.f.geometry ?? null, feature_b_props: clean(b?.f.properties),
    });
  }),
  http.get('*/api/harmonization/matches', async ({ request }) => {
    await wait();
    const wardId = q(request, 'wardId'); const min = Number(q(request, 'minScore') ?? 0);
    return HttpResponse.json(db.matches.filter((m) => (!wardId || m.ward_id === wardId) && m.match_score >= min).sort((a, b) => b.match_score - a.match_score));
  }),
  http.get('*/api/harmonization/schema-map', async ({ request }) => {
    await wait();
    const a = q(request, 'sourceAId'); const b = q(request, 'sourceBId');
    return HttpResponse.json(db.mappings.filter((m) => (!a || m.source_a_id === a) && (!b || m.source_b_id === b)).sort((x, y) => y.confidence - x.confidence));
  }),
  http.post('*/api/harmonization/schema-map', async ({ request }) => {
    await wait(900, 1500);
    const body = await request.json();
    const bCols = body.b?.columns ?? [];
    const mappings = [];
    for (const fa of body.a?.columns ?? []) {
      const exact = bCols.find((fb) => norm(fb) === norm(fa));
      const syn = exact ?? bCols.find((fb) => (SYNONYMS[fa] ?? []).some((s) => norm(s) === norm(fb)));
      if (exact) mappings.push({ field_a: fa, field_b: exact, confidence: 0.97, rationale: 'Identical field name' });
      else if (syn) mappings.push({ field_a: fa, field_b: syn, confidence: fa === 'area_sqm' ? 0.72 : 0.9, rationale: fa === 'area_sqm' ? 'Same quantity, different unit — convert before merging' : 'Same meaning, departmental naming variant' });
    }
    if (body.sourceAId && body.sourceBId) {
      mappings.forEach((m) => db.mappings.push({ id: `map-${Date.now()}-${m.field_a}`, source_a_id: body.sourceAId, source_b_id: body.sourceBId, approved: true, ...m }));
    }
    return HttpResponse.json({ mappings });
  }),

  // ── Conflicts ──
  http.get('*/api/conflicts', async ({ request }) => {
    await wait();
    const wardId = q(request, 'wardId'); const status = q(request, 'status'); const severity = q(request, 'severity');
    return HttpResponse.json(db.conflicts.filter((c) => (!wardId || c.ward_id === wardId) && (!status || c.status === status) && (!severity || c.severity === severity)));
  }),
  http.post('*/api/conflicts/:id/resolve', async ({ params, request }) => {
    await wait();
    const b = await request.json();
    const c = db.conflicts.find((x) => x.id === params.id);
    if (!c) return notFound('Conflict');
    Object.assign(c, { status: b.status, notes: b.notes ?? c.notes, resolved_by: b.resolvedBy ?? 'dev@local', resolved_at: new Date().toISOString() });
    const h = db.harmonized.find((x) => x.match_ids.includes(c.match_id));
    if (h) h.conflict_count = db.conflicts.filter((x) => h.match_ids.includes(x.match_id) && x.status !== 'resolved').length;
    return HttpResponse.json({ status: c.status });
  }),

  // ── Golden records ──
  http.post('*/api/harmonized/assemble', async ({ request }) => {
    await wait(400, 800);
    const wardId = q(request, 'wardId');
    const wards = wardId ? [wardId] : WARDS.map((w) => w.id);
    db.harmonized.forEach((h) => { if (wards.includes(h.ward_id)) h.assembled_at = new Date().toISOString(); });
    wards.forEach((w) => db.track('ASSEMBLE_WARD', { wardId: w, ms: 2000, result: { harmonized_parcels: db.harmonized.filter((h) => h.ward_id === w).length } }));
    return HttpResponse.json({ status: 'processing', jobs: wards.map((w) => `job-assemble-${w}`) }, { status: 202 });
  }),
  http.get('*/api/harmonized/exports', async ({ request }) => {
    await wait();
    const wardId = q(request, 'wardId');
    return HttpResponse.json(db.exports.filter((e) => e.ward_id === wardId));
  }),
  http.get('*/api/harmonized/export', async ({ request }) => {
    await wait(300, 700);
    const wardId = q(request, 'wardId'); const format = q(request, 'format') ?? 'geojson';
    if (!wardId) return HttpResponse.json({ message: 'wardId is required' }, { status: 400 });
    const fc = harmonizedFC(wardId);
    if (!fc.features.length) return HttpResponse.json({ message: 'No harmonized parcels — run POST /api/harmonized/assemble first' }, { status: 400 });
    if (format === 'gpkg') {
      const row = { id: `exp-${Date.now()}`, ward_id: wardId, format: 'gpkg', status: 'processing', feature_count: null, error: null, created_at: new Date().toISOString(), download_url: null };
      db.exports.unshift(row);
      setTimeout(() => Object.assign(row, {
        status: 'ready', feature_count: fc.features.length,
        download_url: `data:application/geo+json;charset=utf-8,${encodeURIComponent(JSON.stringify(fc))}`,
      }), 4000);
      return HttpResponse.json({ status: 'processing', exportId: row.id, jobId: `job-${row.id}` }, { status: 202 });
    }
    return HttpResponse.json({ feature_count: fc.features.length, format: 'geojson', geojson: fc });
  }),
  http.get('*/api/harmonized/:id', async ({ params }) => {
    await wait();
    const h = db.harmonized.find((x) => x.id === params.id);
    return h ? HttpResponse.json(h) : notFound('Harmonized parcel');
  }),
  http.get('*/api/harmonized', async ({ request }) => {
    await wait();
    const wardId = q(request, 'wardId'); const min = Number(q(request, 'minConfidence') ?? 0) / 100;
    return HttpResponse.json(db.harmonized
      .filter((h) => (!wardId || h.ward_id === wardId) && h.confidence >= min)
      .map(({ geometry, member_feature_ids, match_ids, attribute_provenance, ...h }) => ({ ...h, member_count: member_feature_ids.length }))
      .sort((a, b) => b.confidence - a.confidence));
  }),

  // ── Change detection ──
  http.get('*/api/wards/:id/unassessed', async ({ params, request }) => {
    await wait(250, 700);
    const type = q(request, 'type'); const status = q(request, 'status');
    return HttpResponse.json(db.properties
      .filter((p) => p.ward_id === params.id && (!type || p.detection_type === type) && (!status || p.status === status))
      .sort((a, b) => b.confidence - a.confidence));
  }),
  http.get('*/api/properties/:id/explain', async ({ params }) => {
    await wait(600, 1100);
    const p = db.properties.find((x) => x.id === params.id);
    if (!p) return notFound('Property');
    const b = p.confidence_breakdown;
    return HttpResponse.json({
      ai_explanation: `**${p.detection_type === 'new_build' ? 'New construction' : 'Change of use'} likely** (${Math.round(p.confidence * 100)}% confidence).\n\n- NDBI rose by **${b.ndbi_delta.toFixed(2)}** between ${p.baseline_year} and ${p.comparison_year} — new built-up surface.\n- Footprint ~${p.area_sqm} m²; vegetation loss signal ${Math.round(b.ndvi_drop * 100)}%.\n- ${b.db_match < 0.5 ? '**Not** found' : 'Partially found'} in the land-record register.\n\n**Next:** verify on the ground and update the cadastral record.`,
    });
  }),
  http.get('*/api/properties/:id', async ({ params }) => {
    await wait();
    const p = db.properties.find((x) => x.id === params.id);
    return p ? HttpResponse.json(p) : notFound('Property');
  }),
  http.post('*/api/properties/:id/verify', async ({ params, request }) => {
    await wait(250, 600);
    const { status } = await request.json();
    const p = db.properties.find((x) => x.id === params.id);
    if (!p) return notFound('Property');
    p.status = status;
    return HttpResponse.json({ status });
  }),
  http.get('*/api/stats', async ({ request }) => {
    await wait(200, 600);
    return HttpResponse.json(computeStats(q(request, 'ward_id')));
  }),

  // ── Admin / AI ──
  http.post('*/api/admin/db-config', async ({ request }) => {
    await wait();
    const b = await request.json();
    if (b.ndbi_threshold != null) db.config.ndbi_threshold = Number(b.ndbi_threshold);
    return HttpResponse.json({});
  }),
  http.post('*/api/admin/refresh', async () => {
    await wait();
    db.config.pipeline_status = 'running';
    setTimeout(() => { db.config.pipeline_status = 'completed'; db.config.last_refresh = new Date().toISOString(); }, 12000);
    return HttpResponse.json({ triggered: true, jobs: WARDS.length }, { status: 202 });
  }),
  http.post('*/api/chat', async ({ request }) => {
    await wait(600, 1100);
    const { message } = await request.json();
    return HttpResponse.json({ response: CHAT_ANSWERS[String(message).length % CHAT_ANSWERS.length] });
  }),
];
