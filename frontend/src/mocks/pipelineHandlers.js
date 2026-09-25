import { HttpResponse, delay, http } from 'msw';
import { WARDS } from './data';
import {
  AI_FEATURES, AUDIT, CHANGE_DETECTIONS, CHANGE_RUNS, EXTRACTION_RUNS, EXTRA_SOURCES, JOBS, SYNC_FINDINGS, TOPOLOGY_ISSUES,
  VALIDATION_REPORTS, materializeChanges,
} from './data/pipeline';
import { MIN_GCPS, fromUtm, solveTransform, toUtm } from '../utils/affine';

const wait = (min = 120, max = 450) => delay(min + Math.random() * (max - min));
const q = (request, key) => new URL(request.url).searchParams.get(key);
const bad = (message, status = 400) => HttpResponse.json({ message }, { status });
let seq = 0;
const nid = (p) => `${p}-m${Date.now().toString(36)}${(++seq).toString(36)}`;

const CRS = [
  { code: 'EPSG:4326', name: 'WGS 84 (GPS lon/lat)', units: 'degrees' },
  { code: 'EPSG:3857', name: 'Web Mercator', units: 'metres' },
  { code: 'EPSG:32643', name: 'WGS 84 / UTM 43N (west India)', units: 'metres' },
  { code: 'EPSG:32644', name: 'WGS 84 / UTM 44N (central/AP)', units: 'metres' },
  { code: 'EPSG:32645', name: 'WGS 84 / UTM 45N (east India)', units: 'metres' },
];

function transform(from, to, [x, y]) {
  const toWgs = (c, [a, b]) => {
    if (c === 'EPSG:4326') return [a, b];
    if (c === 'EPSG:3857') return [(a / 6378137) * (180 / Math.PI), (2 * Math.atan(Math.exp(b / 6378137)) - Math.PI / 2) * (180 / Math.PI)];
    return fromUtm(a, b, Number(c.slice(-2)));
  };
  const fromWgs = (c, [lon, lat]) => {
    if (c === 'EPSG:4326') return [lon, lat];
    if (c === 'EPSG:3857') return [6378137 * lon * (Math.PI / 180), 6378137 * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
    return toUtm(lon, lat, Number(c.slice(-2)));
  };
  return fromWgs(to, toWgs(from, [x, y]));
}

/** Mock pipeline jobs: queued → running → done, then `onDone` mutates the mock database. */
export function makeTracker(db) {
  return function track(jobType, { wardId = null, sourceId = null, ms = 2500, result = {}, onDone } = {}) {
    const j = { id: nid('job'), job_type: jobType, ward_id: wardId, source_id: sourceId, status: 'queued', attempts: 0, result: null, error: null, created_at: new Date().toISOString(), started_at: null, finished_at: null };
    db.jobs.unshift(j);
    setTimeout(() => { Object.assign(j, { status: 'running', attempts: 1, started_at: new Date().toISOString() }); }, 400);
    setTimeout(() => {
      const extra = onDone?.() ?? {};
      Object.assign(j, { status: 'done', finished_at: new Date().toISOString(), result: { ...result, ...extra } });
    }, ms);
    return j.id;
  };
}

export function pipelineHandlers(db) {
  const track = makeTracker(db);
  db.jobs = structuredClone(JOBS);
  db.audit = structuredClone(AUDIT);
  db.runs = structuredClone(EXTRACTION_RUNS);
  db.issues = structuredClone(TOPOLOGY_ISSUES);
  db.changeRuns = structuredClone(CHANGE_RUNS);
  db.changes = structuredClone(CHANGE_DETECTIONS);
  db.reports = structuredClone(VALIDATION_REPORTS);
  db.findings = structuredClone(SYNC_FINDINGS);
  for (const s of structuredClone(EXTRA_SOURCES)) db.sources.push(s);
  Object.assign(db.features, structuredClone(AI_FEATURES));
  const audit = (action, entity, detail = {}) => db.audit.unshift({ id: nid('aud'), actor_email: 'dev@local', action, entity, detail, created_at: new Date().toISOString() });
  db.track = track;
  db.audit_ = audit;

  return [
    // ── jobs / audit ──
    http.get('*/api/jobs', async ({ request }) => {
      await wait(60, 150);
      const wardId = q(request, 'wardId'); const status = q(request, 'status'); const limit = Number(q(request, 'limit') ?? 50);
      return HttpResponse.json(db.jobs.filter((j) => (!wardId || j.ward_id === wardId) && (!status || j.status === status))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit));
    }),
    http.get('*/api/audit', async () => { await wait(); return HttpResponse.json(db.audit); }),

    // ── extraction ──
    http.get('*/api/extraction/runs', async ({ request }) => {
      await wait();
      const wardId = q(request, 'wardId');
      return HttpResponse.json(db.runs.filter((r) => !wardId || r.ward_id === wardId).sort((a, b) => b.created_at.localeCompare(a.created_at)));
    }),
    http.post('*/api/extraction/run', async ({ request }) => {
      await wait();
      const b = await request.json();
      const src = db.sources.find((s) => s.id === b.sourceId);
      if (!src) return bad('Source not found', 404);
      if (!['ori', 'drone_imagery', 'dsm_dtm'].includes(src.type)) return bad('Extraction runs on drone imagery, ORI or DSM/DTM sources');
      const method = b.method ?? 'auto';
      const used = method === 'auto' ? (src.type === 'dsm_dtm' ? 'ndsm' : 'classical') : method;
      if (used === 'model') return bad("method 'model' needs FOOTPRINT_MODEL_PATH pointing to an ONNX model (not configured in the demo)");
      const prev = db.runs.find((r) => r.ward_id === src.ward_id && r.status === 'done');
      const run = { id: nid('run'), ward_id: src.ward_id, source_id: src.id, source_name: src.original_name, source_type: src.type, method, method_used: null, params: b.params ?? {}, status: 'queued', result_source_id: null, feature_count: null, metrics: {}, error: null, created_at: new Date().toISOString(), finished_at: null };
      db.runs.unshift(run);
      const jobId = track('EXTRACT_FEATURES', {
        wardId: src.ward_id, sourceId: src.id, ms: 3500,
        onDone: () => Object.assign(run, { status: 'done', method_used: used, result_source_id: prev?.result_source_id ?? null, feature_count: prev?.feature_count ?? 0, metrics: { ...(prev?.metrics ?? {}), mean_confidence: used === 'classical' ? 0.5 : prev?.metrics?.mean_confidence }, finished_at: new Date().toISOString() }) && { method: used, features: prev?.feature_count ?? 0 },
      });
      setTimeout(() => { if (run.status === 'queued') run.status = 'running'; }, 500);
      audit('extraction.run', `data_sources:${src.id}`, { method });
      return HttpResponse.json({ run, jobId }, { status: 202 });
    }),

    // ── topology ──
    http.get('*/api/topology/issues', async ({ request }) => {
      await wait();
      const wardId = q(request, 'wardId'); const sourceId = q(request, 'sourceId'); const status = q(request, 'status');
      return HttpResponse.json(db.issues.filter((i) => (!wardId || i.ward_id === wardId) && (!sourceId || i.source_id === sourceId) && (!status || i.status === status)));
    }),
    http.post('*/api/topology/run', async ({ request }) => {
      await wait();
      const b = await request.json();
      const src = db.sources.find((s) => s.id === b.sourceId);
      if (!src) return bad('Source not found', 404);
      const jobId = track('FIX_TOPOLOGY', {
        wardId: src.ward_id, sourceId: src.id, ms: 2200,
        onDone: () => {
          const mine = db.issues.filter((i) => i.source_id === src.id && i.status === 'open');
          if (b.autoFix) mine.forEach((i) => { if (i.fix?.action && i.fix.action !== 'make_valid') i.status = 'auto_fixed'; });
          return { issues: mine.length, auto_fixed: b.autoFix ? mine.length : 0 };
        },
      });
      audit('topology.run', `data_sources:${src.id}`, b);
      return HttpResponse.json({ status: 'processing', jobId }, { status: 202 });
    }),
    http.post('*/api/topology/issues/:id/resolve', async ({ params, request }) => {
      await wait();
      const { action } = await request.json();
      const i = db.issues.find((x) => x.id === params.id);
      if (!i) return bad('Topology issue not found', 404);
      if (action === 'accept_fix' && i.status !== 'open') return bad(`issue is already ${i.status}`);
      if (action === 'reopen' && (i.status === 'accepted' || i.status === 'auto_fixed')) return bad('an applied fix cannot be reopened; re-run the topology check instead');
      i.status = action === 'accept_fix' ? 'accepted' : action === 'ignore' ? 'ignored' : 'open';
      i.resolved_by = 'dev@local'; i.resolved_at = new Date().toISOString();
      audit(`topology.${action}`, `topology_issues:${i.id}`, { issue_type: i.issue_type });
      if (action === 'accept_fix') track('HARMONIZE_WARD', { wardId: i.ward_id, ms: 1800, result: { matches: 40 } });
      return HttpResponse.json({ id: i.id, status: i.status, ward_id: i.ward_id });
    }),
    http.post('*/api/topology/sources/:sourceId/accept-all', async ({ params }) => {
      await wait();
      const open = db.issues.filter((i) => i.source_id === params.sourceId && i.status === 'open' && i.fix?.action !== 'make_valid');
      open.forEach((i) => { i.status = 'accepted'; i.resolved_by = 'dev@local'; i.resolved_at = new Date().toISOString(); });
      audit('topology.accept_all', `data_sources:${params.sourceId}`, { accepted: open.length });
      return HttpResponse.json({ accepted: open.length, failed: [], ward_id: open[0]?.ward_id ?? null });
    }),

    // ── CRS + geo-referencing ──
    http.get('*/api/crs', async () => { await wait(40, 120); return HttpResponse.json(CRS); }),
    http.post('*/api/crs/transform', async ({ request }) => {
      await wait();
      const { from, to, points } = await request.json();
      if (![from, to].every((c) => CRS.some((x) => x.code === c))) return bad(`unsupported CRS in the demo (${from} → ${to})`);
      return HttpResponse.json({ from, to, points: points.map((p) => transform(from, to, p)) });
    }),
    http.post('*/api/georef/:id/preview', async ({ request }) => {
      await wait(60, 150);
      const { gcps, kind = 'affine' } = await request.json();
      if (gcps.length < MIN_GCPS[kind]) return HttpResponse.json({ kind, ok: false, needed: MIN_GCPS[kind], residuals_m: [], rmse_m: null });
      try {
        const sol = solveTransform(gcps, kind);
        const lat = gcps.reduce((s, g) => s + g.y, 0) / gcps.length;
        const m = (v) => Math.round(v * 111320 * Math.cos((lat * Math.PI) / 180) * 1000) / 1000;
        return HttpResponse.json({ kind, ok: true, needed: MIN_GCPS[kind], residuals_m: sol.residuals.map(m), rmse_m: m(sol.rmse) });
      } catch (e) { return bad(e.message); }
    }),
    http.post('*/api/georef/:id/apply', async ({ params, request }) => {
      await wait();
      const { gcps, kind = 'affine', crs = 'EPSG:4326' } = await request.json();
      const src = db.sources.find((s) => s.id === params.id);
      if (!src) return bad('Source not found', 404);
      let sol;
      try { sol = solveTransform(gcps, kind); } catch (e) { return bad(e.message); }
      src.status = 'processing';
      const { image_width: W = 1000, image_height: H = 700 } = src.metadata ?? {};
      const jobId = track('GEOREFERENCE', {
        wardId: src.ward_id, sourceId: src.id, ms: 3000,
        onDone: () => {
          const ring = [[0, 0], [W, 0], [W, H], [0, H], [0, 0]].map(([px, py]) => sol.apply(px, py));
          db.features[src.id] = [{ type: 'Feature', id: nid('f'), geometry: { type: 'Polygon', coordinates: [ring] }, properties: { bands: 3, res: 'scan', dtype: 'uint8' } }];
          Object.assign(src, { status: 'ready', crs, metadata: { ...src.metadata, feature_count: 1, georef: { kind, crs, gcp_count: gcps.length, rmse: sol.rmse } } });
          return { rmse: sol.rmse, kind };
        },
      });
      audit('georef.apply', `data_sources:${src.id}`, { kind, gcp_count: gcps.length });
      return HttpResponse.json({ status: 'processing', jobId }, { status: 202 });
    }),

    // ── change detection ──
    http.get('*/api/changes/runs', async ({ request }) => {
      await wait();
      const wardId = q(request, 'wardId');
      return HttpResponse.json(db.changeRuns.filter((r) => !wardId || r.ward_id === wardId).sort((a, b) => b.created_at.localeCompare(a.created_at)));
    }),
    http.post('*/api/changes/run', async ({ request }) => {
      await wait();
      const b = await request.json();
      if (b.baselineSourceId === b.currentSourceId) return bad('choose two different sources');
      const bs = db.sources.find((s) => s.id === b.baselineSourceId); const cs = db.sources.find((s) => s.id === b.currentSourceId);
      if (!bs || !cs) return bad('Source not found', 404);
      const run = {
        id: nid('crun'), ward_id: b.wardId, baseline_source_id: bs.id, current_source_id: cs.id, baseline_name: bs.original_name, current_name: cs.original_name,
        baseline_captured: bs.captured_at, current_captured: cs.captured_at, params: b.params ?? {}, status: 'queued', summary: {}, error: null, created_at: new Date().toISOString(),
      };
      db.changeRuns.unshift(run);
      setTimeout(() => { if (run.status === 'queued') run.status = 'running'; }, 500);
      const jobId = track('DETECT_CHANGES', {
        wardId: b.wardId, ms: 2800,
        onDone: () => {
          const rows = cs.type === 'ai_extracted' || bs.type === 'ai_extracted' ? materializeChanges(run) : (Object.assign(run, { status: 'done', finished_at: new Date().toISOString() }), []);
          db.changes.push(...structuredClone(rows));
          return { changes: rows.length, by_type: run.summary };
        },
      });
      audit('changes.run', `change_runs:${run.id}`, b);
      return HttpResponse.json({ run, jobId }, { status: 202 });
    }),
    http.get('*/api/changes', async ({ request }) => {
      await wait();
      const runId = q(request, 'runId'); const wardId = q(request, 'wardId');
      return HttpResponse.json(db.changes.filter((c) => (!runId || c.run_id === runId) && (!wardId || c.ward_id === wardId)));
    }),
    http.post('*/api/changes/:id/verify', async ({ params, request }) => {
      await wait();
      const { status } = await request.json();
      const c = db.changes.find((x) => x.id === params.id);
      if (!c) return bad('Change not found', 404);
      Object.assign(c, { status, verified_by: 'dev@local', verified_at: new Date().toISOString() });
      audit('changes.verify', `change_detections:${c.id}`, { status });
      return HttpResponse.json({ id: c.id, status });
    }),

    // ── validation ──
    http.post('*/api/validation/run', async ({ request }) => {
      await wait();
      const { wardId } = await request.json();
      const jobId = track('VALIDATE_WARD', {
        wardId, ms: 2400,
        onDone: () => {
          const ts = new Date().toISOString();
          db.reports.filter((r) => r.ward_id === wardId).forEach((r) => {
            if (r.source_type === 'cadastral') {
              const open = db.issues.filter((i) => i.source_id === r.source_id && i.status === 'open').length;
              const c = r.checks.find((x) => x.key === 'topology');
              Object.assign(c, { value: 1 / (1 + open), passed: open === 0, detail: `${open} open issues` });
              r.score = Math.round((1000 * r.checks.reduce((a, x) => a + x.weight * x.value, 0)) / r.checks.reduce((a, x) => a + x.weight, 0)) / 10;
            }
            r.created_at = ts;
          });
          return { ward_score: db.reports.find((r) => r.ward_id === wardId && !r.source_id)?.score };
        },
      });
      audit('validation.run', `wards:${wardId}`);
      return HttpResponse.json({ status: 'processing', jobId }, { status: 202 });
    }),
    http.get('*/api/validation/reports', async ({ request }) => {
      await wait();
      const wardId = q(request, 'wardId');
      return HttpResponse.json(db.reports.filter((r) => !wardId || r.ward_id === wardId));
    }),
    http.get('*/api/validation/findings', async ({ request }) => {
      await wait();
      const wardId = q(request, 'wardId');
      return HttpResponse.json({
        type: 'FeatureCollection',
        features: db.findings.filter((f) => !wardId || f.ward_id === wardId).map((f) => ({ type: 'Feature', id: f.id, geometry: f.geometry, properties: { finding_type: f.finding_type, ward_id: f.ward_id, feature_ids: f.feature_ids, ...f.detail } })),
      });
    }),

    // ── finalisation readiness (before '/api/harmonized/:id') ──
    http.get('*/api/harmonized/readiness', async ({ request }) => {
      await wait();
      const wardId = q(request, 'wardId');
      const rows = db.harmonized.filter((h) => !wardId || h.ward_id === wardId).map((h) => {
        const topo = db.issues.filter((i) => i.status === 'open' && i.feature_ids.some((f) => h.member_feature_ids.includes(f))).length;
        const readiness = h.conflict_count > 0 ? 'blocked_conflict' : topo > 0 ? 'blocked_topology' : h.confidence < 0.85 ? 'low_confidence' : 'ready';
        return { id: h.id, ward_id: h.ward_id, confidence: h.confidence, conflict_count: h.conflict_count, topology_open: topo, readiness };
      });
      const c = { ready: 0, blocked_conflict: 0, blocked_topology: 0, low_confidence: 0 };
      rows.forEach((r) => { c[r.readiness] += 1; });
      return HttpResponse.json({ total: rows.length, ...c, ready_pct: rows.length ? Math.round((1000 * c.ready) / rows.length) / 10 : 0, parcels: rows });
    }),

    // ── OGC API – Features ──
    http.get('*/api/ogc/collections/:id/items', async ({ params, request }) => {
      await wait();
      const wardId = q(request, 'wardId'); const limit = Math.min(1000, Number(q(request, 'limit') ?? 100)); const offset = Number(q(request, 'offset') ?? 0);
      const byWard = (x) => !wardId || x.ward_id === wardId;
      let feats;
      if (params.id === 'harmonized-parcels') feats = db.harmonized.filter(byWard).map((h) => ({ type: 'Feature', id: h.id, geometry: h.geometry, properties: { ...h.attributes, ward_id: h.ward_id, confidence: h.confidence, conflict_count: h.conflict_count } }));
      else if (params.id === 'change-detections') feats = db.changes.filter(byWard).map((c) => ({ type: 'Feature', id: c.id, geometry: c.geometry, properties: { ward_id: c.ward_id, change_type: c.change_type, confidence: c.confidence, status: c.status } }));
      else if (params.id === 'topology-issues') feats = db.issues.filter(byWard).map((i) => ({ type: 'Feature', id: i.id, geometry: i.geometry, properties: { ward_id: i.ward_id, issue_type: i.issue_type, area_sqm: i.area_sqm, status: i.status } }));
      else if (params.id === 'sync-findings') feats = db.findings.filter(byWard).map((f) => ({ type: 'Feature', id: f.id, geometry: f.geometry, properties: { ward_id: f.ward_id, finding_type: f.finding_type, ...f.detail } }));
      else if (params.id.startsWith('source-')) feats = (db.features[params.id.slice(7)] ?? []).map((f) => ({ ...f, properties: Object.fromEntries(Object.entries(f.properties).filter(([k]) => !k.startsWith('_'))) }));
      else return bad(`collection ${params.id} not found`, 404);
      const page = feats.slice(offset, offset + limit);
      return HttpResponse.json({
        type: 'FeatureCollection', features: page, numberMatched: feats.length, numberReturned: page.length, timeStamp: new Date().toISOString(),
        links: [{ rel: 'self', href: request.url }, ...(offset + limit < feats.length ? [{ rel: 'next', href: `${request.url.split('?')[0]}?limit=${limit}&offset=${offset + limit}` }] : [])],
      });
    }),
    http.get('*/api/ogc/collections', async () => {
      await wait();
      const stat = [
        ['harmonized-parcels', 'Harmonized parcels (golden records)', db.harmonized.length],
        ['change-detections', 'Structural change detections', db.changes.length],
        ['topology-issues', 'Topology issues', db.issues.length],
        ['sync-findings', 'AI ↔ cadastre synchronisation findings', db.findings.length],
      ];
      const src = db.sources.filter((s) => s.status === 'ready' && !['ori', 'drone_imagery', 'dsm_dtm'].includes(s.type) && (db.features[s.id]?.length ?? 0) > 0)
        .map((s) => [`source-${s.id}`, `${s.type}: ${s.original_name}`, db.features[s.id].length]);
      return HttpResponse.json({ collections: [...stat, ...src].map(([id, title, count]) => ({ id, title, itemType: 'feature', numberOfFeatures: count, crs: ['http://www.opengis.net/def/crs/OGC/1.3/CRS84'] })) });
    }),

    // ── upload completion (ETL starts once the object exists) ──
    http.post('*/api/sources/:id/complete', async ({ params }) => {
      await wait();
      const s = db.sources.find((x) => x.id === params.id);
      if (!s) return bad('Source not found', 404);
      if (s.scanned) return HttpResponse.json({ status: 'pending_ocr', jobId: null });
      const scan = /\.(png|jpe?g)$/i.test(s.original_name ?? '');
      const jobId = track('NORMALIZE_SOURCE', {
        wardId: s.ward_id, sourceId: s.id, ms: 2500,
        onDone: () => {
          if (scan) {
            const preview = EXTRA_SOURCES.find((x) => x.id === 'src-1-scanmap');
            Object.assign(s, { status: 'needs_georef', preview_url: preview?.preview_url, metadata: { ...preview?.metadata, preview_key: `previews/${s.id}.png` } });
            return { status: 'needs_georef' };
          }
          Object.assign(s, { status: 'ready', metadata: { ...s.metadata, fields: [], feature_count: 0 } });
          return { features: 0 };
        },
      });
      return HttpResponse.json({ status: 'processing', jobId }, { status: 202 });
    }),
    // Demo wards list is shared.
    http.get('*/api/ogc', async () => HttpResponse.json({ title: 'NAKSHA land-record integration — OGC API Features', links: [] })),
    http.get('*/api/ogc/conformance', async () => HttpResponse.json({ conformsTo: ['http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core', 'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson'] })),
    ...(WARDS.length ? [] : []),
  ];
}
