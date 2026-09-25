// Demo data for the pipeline features (AI extraction, topology, change detection, validation,
// geo-referencing, jobs, audit), derived from the parcels / footprints in ./index.js so every
// layer lines up on the map. Shapes follow the NestJS API responses.
import { CONFLICTS, FEATURES, HARMONIZED, MATCHES, SOURCES, WARDS } from './index';

const M_LAT = 1 / 110574;
const M_LON = 1 / (111320 * Math.cos((17.73 * Math.PI) / 180));
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

const bounds = (geom) => {
  const pts = geom.coordinates[0];
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  return { w: Math.min(...xs), e: Math.max(...xs), s: Math.min(...ys), n: Math.max(...ys) };
};
const rect = ({ w, e, s, n }) => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
const areaM2 = (b) => Math.abs((b.e - b.w) / M_LON) * Math.abs((b.n - b.s) / M_LAT);

export const AI_FEATURES = {};        // sourceId -> Feature[]
export const EXTRACTION_RUNS = [];
export const TOPOLOGY_ISSUES = [];
export const CHANGE_RUNS = [];
export const CHANGE_DETECTIONS = [];
export const EXPECTED_CHANGES = {};   // wardId -> detections template (used when a run is triggered)
export const VALIDATION_REPORTS = [];
export const SYNC_FINDINGS = [];
export const JOBS = [];
export const AUDIT = [];
export const EXTRA_SOURCES = [];

let n = 0;
const id = (p) => `${p}-${String(++n).padStart(5, '0')}`;

const job = (type, wardId, minsAgo, result, sourceId = null) => {
  JOBS.push({
    id: id('job'), job_type: type, ward_id: wardId, source_id: sourceId, status: 'done', attempts: 1, result, error: null,
    created_at: iso(minsAgo * 60e3), started_at: iso(minsAgo * 60e3 - 800), finished_at: iso(minsAgo * 60e3 - 800 - 1500 - Math.random() * 3000),
  });
};

for (const w of WARDS) {
  const W = w.id;
  const cad = FEATURES[`src-${W}-cadastral`] ?? [];
  const bld = FEATURES[`src-${W}-building_footprint`] ?? [];
  const ori = SOURCES.find((s) => s.id === `src-${W}-ori`);

  // ── AI-extracted footprints (2025 imagery): one demolished, one extended, one raised, two new.
  const ai = [];
  const templates = [];
  bld.forEach((f, k) => {
    const b = bounds(f.geometry);
    const h = Number(f.properties.height_m ?? 6);
    if (k === 0) { templates.push({ change_type: 'demolished', geom: f.geometry, before: f.geometry, area_before: areaM2(b), height_before: h }); return; }
    let nb = { w: b.w + 0.3 * M_LON, e: b.e + 0.3 * M_LON, s: b.s + 0.2 * M_LAT, n: b.n + 0.2 * M_LAT };
    let height = h + (Math.random() - 0.5) * 0.4;
    if (k === 1) {
      nb = { ...nb, e: nb.e + (nb.e - nb.w) * 0.5 };
      templates.push({ change_type: 'extension', geom: rect(nb), before: f.geometry, area_before: areaM2(b), area_after: areaM2(nb), height_before: h, height_after: round(height, 1) });
    }
    if (k === 2) {
      height = h + 6.4;
      templates.push({ change_type: 'vertical_extension', geom: rect(nb), before: f.geometry, area_before: areaM2(b), area_after: areaM2(nb), height_before: h, height_after: round(height, 1) });
    }
    ai.push({ type: 'Feature', id: id('fai'), geometry: rect(nb), properties: { area_sqm: round(areaM2(nb), 1), confidence: round(0.82 + (k % 4) * 0.04, 2), height_m: round(height, 1), method: 'ndsm' } });
  });
  // New structure in open ground beyond the parcel grid (unregistered) …
  if (cad.length) {
    const last = bounds(cad[cad.length - 1].geometry);
    const nb1 = { w: last.e + 14 * M_LON, e: last.e + 24 * M_LON, s: last.s + 4 * M_LAT, n: last.s + 12 * M_LAT };
    // … and one straddling two parcels (encroachment).
    const p0 = bounds(cad[0].geometry);
    const nb2 = { w: p0.e - 6 * M_LON, e: p0.e + 9 * M_LON, s: p0.s + 3 * M_LAT, n: p0.s + 10 * M_LAT };
    for (const [nb, conf, h] of [[nb1, 0.79, 3.4], [nb2, 0.84, 6.1]]) {
      const g = rect(nb);
      ai.push({ type: 'Feature', id: id('fai'), geometry: g, properties: { area_sqm: round(areaM2(nb), 1), confidence: conf, height_m: h, method: 'ndsm' } });
      templates.push({ change_type: 'new_structure', geom: g, before: null, area_after: areaM2(nb), height_after: h });
    }
    SYNC_FINDINGS.push(
      { id: id('sf'), ward_id: W, finding_type: 'unregistered_structure', geometry: rect(nb1), feature_ids: [], detail: { area_sqm: round(areaM2(nb1), 1), source_type: 'ai_extracted', confidence: 0.79 } },
      { id: id('sf'), ward_id: W, finding_type: 'encroachment', geometry: rect({ ...nb2, w: p0.e }), feature_ids: [cad[0].id], detail: { outside_sqm: round(areaM2({ ...nb2, w: p0.e }), 1), outside_pct: 60, parcel_id: cad[0].properties.parcel_id } },
    );
  }
  const aiId = `src-${W}-ai_extracted`;
  AI_FEATURES[aiId] = ai;
  EXTRA_SOURCES.push({
    id: aiId, type: 'ai_extracted', ward_id: W, original_name: `ai_footprints_ndsm_ward${W}_ori_latest.geojson`, status: 'ready', crs: 'EPSG:4326',
    captured_at: iso(90 * 864e5), scanned: false, created_at: iso(2 * 864e5), error: null,
    metadata: { fields: ['area_sqm', 'confidence', 'height_m', 'method'], feature_count: ai.length, parent_source_id: ori?.id, method: 'ndsm' },
  });
  EXPECTED_CHANGES[W] = templates;

  // ── Extraction run that produced it.
  const heights = ai.map((f) => f.properties.height_m);
  const areas = ai.map((f) => f.properties.area_sqm);
  EXTRACTION_RUNS.push({
    id: id('run'), ward_id: W, source_id: ori?.id, source_name: ori?.original_name, source_type: 'ori', method: 'auto', method_used: 'ndsm',
    params: { min_height_m: 2.5, min_area_sqm: 20 }, status: 'done', result_source_id: aiId, feature_count: ai.length,
    metrics: {
      feature_count: ai.length, mean_confidence: round(ai.reduce((s, f) => s + f.properties.confidence, 0) / (ai.length || 1), 3),
      mean_height_m: round(heights.reduce((a, b) => a + b, 0) / (heights.length || 1), 2), total_area_sqm: round(areas.reduce((a, b) => a + b, 0), 1),
      area_histogram: [0, 50, 100, 200, 400, 1e9].slice(0, -1).map((lo, i, arr) => areas.filter((a) => a >= lo && a < ([...arr, 1e9][i + 1] ?? 1e9)).length),
      pixel_size_m: 0.1,
    },
    error: null, created_at: iso(2 * 864e5), finished_at: iso(2 * 864e5 - 42e3),
  });

  // ── Topology issues on the cadastral fabric (open, with proposed fixes).
  const issue = (type, geom, ids, area, fix, target) => TOPOLOGY_ISSUES.push({
    id: id('topo'), ward_id: W, source_id: `src-${W}-cadastral`, source_type: 'cadastral', source_name: `ward${W}_cadastral_map.shp`,
    issue_type: type, geometry: geom, fixed_geometry: target ? target.geometry : null, area_sqm: area, feature_ids: ids,
    status: type === 'self_intersection' ? 'auto_fixed' : 'open', fix, resolved_by: null, resolved_at: null, created_at: iso(864e5),
  });
  if (cad.length >= 11) {
    const b0 = bounds(cad[0].geometry); const b1 = bounds(cad[1].geometry);
    issue('overlap', rect({ w: b1.w - 1.6 * M_LON, e: b1.w, s: b1.s, n: Math.min(b0.n, b1.n) }), [cad[0].id, cad[1].id], round(1.6 * (b1.n - b1.s) / M_LAT, 2),
      { action: 'clip_from', target: cad[1].id, keep: cad[0].id }, cad[1]);
    const b5 = bounds(cad[5].geometry); const b6 = bounds(cad[6].geometry);
    issue('gap', rect({ w: b5.e, e: b6.w, s: b5.s, n: b5.n }), [cad[5].id, cad[6].id], round(((b6.w - b5.e) / M_LON) * ((b5.n - b5.s) / M_LAT), 2),
      { action: 'merge_into', target: cad[5].id }, cad[5]);
    const b9 = bounds(cad[9].geometry);
    issue('sliver', rect({ w: b9.e, e: b9.e + 0.3 * M_LON, s: b9.s, n: b9.n }), [cad[9].id, cad[10].id], round(0.3 * (b9.n - b9.s) / M_LAT, 2),
      { action: 'merge_into', target: cad[9].id }, cad[9]);
    issue('duplicate_vertex', cad[3].geometry, [cad[3].id], 0, { action: 'remove_repeated_points', target: cad[3].id, vertices_removed: 2 }, cad[3]);
    cad.filter((f) => f.properties._was_invalid).forEach((f) => issue('self_intersection', f.geometry, [f.id], 0, { action: 'make_valid', target: f.id }, null));
  }

  // ── Vacant parcels (no structure) and attribute drift from open attribute conflicts.
  cad.forEach((p) => {
    const pb = bounds(p.geometry);
    const has = [...bld, ...ai].some((f) => { const b = bounds(f.geometry); return b.w < pb.e && b.e > pb.w && b.s < pb.n && b.n > pb.s; });
    if (!has) SYNC_FINDINGS.push({ id: id('sf'), ward_id: W, finding_type: 'vacant_parcel', geometry: p.geometry, feature_ids: [p.id], detail: { parcel_id: p.properties.parcel_id, area_sqm: p.properties.area_sqm } });
  });
  CONFLICTS.filter((c) => c.ward_id === W && c.conflict_type !== 'geometry_mismatch').forEach((c) => {
    const m = MATCHES.find((x) => x.id === c.match_id);
    const f = cad.find((x) => x.id === m?.feature_a_id);
    if (f) SYNC_FINDINGS.push({ id: id('sf'), ward_id: W, finding_type: 'attribute_drift', geometry: f.geometry, feature_ids: [m.feature_a_id, m.feature_b_id], detail: { fields: c.detail.disagreeing_fields, conflict_id: c.id } });
  });

  // ── Validation reports (latest per source + ward summary).
  const wardSources = [...SOURCES, ...EXTRA_SOURCES].filter((s) => s.ward_id === W && s.status === 'ready' && !['ori', 'drone_imagery', 'dsm_dtm'].includes(s.type));
  const scores = [];
  wardSources.forEach((s, i) => {
    const topoOpen = s.type === 'cadastral' ? TOPOLOGY_ISSUES.filter((t) => t.source_id === s.id && t.status === 'open').length : 0;
    const comp = s.type === 'revenue' ? 0.86 : 0.97 - (i % 3) * 0.01;
    const checks = [
      { key: 'crs', label: 'Coordinate reference system declared', value: s.crs ? 1 : 0.5, passed: Boolean(s.crs), weight: 1, detail: s.crs ?? 'detected from file' },
      { key: 'geometry_validity', label: 'Valid geometries', value: 1, passed: true, weight: 2, detail: '100% valid' },
      { key: 'completeness', label: 'Attribute completeness', value: comp, passed: comp >= 0.9, weight: 2, detail: `${Math.round(comp * 100)}% of fields filled` },
      { key: 'duplicates', label: 'Unique identifiers', value: 1, passed: true, weight: 1, detail: '0 duplicate identifiers' },
      { key: 'coverage', label: 'Within ward boundary', value: 1, passed: true, weight: 1, detail: '100% of features' },
      { key: 'topology', label: 'No open topology issues', value: 1 / (1 + topoOpen), passed: topoOpen === 0, weight: 2, detail: `${topoOpen} open issues` },
      { key: 'freshness', label: 'Captured within 5 years', value: s.captured_at && new Date(s.captured_at) < new Date('2021-01-01') ? 0.8 : 1, passed: !(s.captured_at && new Date(s.captured_at) < new Date('2021-01-01')), weight: 1, detail: s.captured_at ? new Date(s.captured_at).getFullYear().toString() : 'unknown' },
    ];
    const score = round((100 * checks.reduce((a, c) => a + c.weight * c.value, 0)) / checks.reduce((a, c) => a + c.weight, 0), 1);
    scores.push(score);
    VALIDATION_REPORTS.push({ id: id('vr'), ward_id: W, source_id: s.id, source_type: s.type, source_name: s.original_name, score, checks, created_at: iso(3600e3) });
  });
  const f = (t) => SYNC_FINDINGS.filter((x) => x.ward_id === W && x.finding_type === t).length;
  const wardChecks = [
    { key: 'source_quality', label: 'Mean source quality', value: scores.reduce((a, b) => a + b, 0) / scores.length / 100, passed: Math.min(...scores) >= 70, weight: 3, detail: `${scores.length} sources validated` },
    { key: 'registered_structures', label: 'Structures registered in cadastre', value: 1 - f('unregistered_structure') / (ai.length || 1), passed: f('unregistered_structure') === 0, weight: 3, detail: `${f('unregistered_structure')} of ${ai.length} structures unregistered` },
    { key: 'encroachments', label: 'No boundary encroachments', value: 1 / (1 + f('encroachment')), passed: f('encroachment') === 0, weight: 2, detail: '' },
    { key: 'attribute_drift', label: 'Attributes agree across departments', value: 1 / (1 + f('attribute_drift')), passed: f('attribute_drift') === 0, weight: 2, detail: '' },
  ];
  VALIDATION_REPORTS.push({
    id: id('vr'), ward_id: W, source_id: null, score: round((100 * wardChecks.reduce((a, c) => a + c.weight * c.value, 0)) / wardChecks.reduce((a, c) => a + c.weight, 0), 1),
    checks: wardChecks, created_at: iso(3600e3),
  });

  // ── Job history.
  let t = 60 * 30;
  for (const [type, res, src] of [
    ['NORMALIZE_SOURCE', { features: cad.length, repaired: 2 }, `src-${W}-cadastral`], ['NORMALIZE_SOURCE', { features: 1 }, ori?.id],
    ['EXTRACT_FEATURES', { method: 'ndsm', features: ai.length }, ori?.id], ['FIX_TOPOLOGY', { issues: 6, auto_fixed: 0 }, `src-${W}-cadastral`],
    ['HARMONIZE_WARD', { matches: MATCHES.filter((m) => m.ward_id === W).length }], ['DETECT_CONFLICTS', { conflicts_created: CONFLICTS.filter((c) => c.ward_id === W).length }],
    ['ASSEMBLE_WARD', { harmonized_parcels: HARMONIZED.filter((h) => h.ward_id === W).length }], ['VALIDATE_WARD', { ward_score: VALIDATION_REPORTS.at(-1).score }],
  ]) { job(type, W, t, res, src); t -= 3 + Number(W); }
}

// A scanned (non-georeferenced) cadastral sheet waiting for control points.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700" viewBox="0 0 1000 700">
<rect width="1000" height="700" fill="#f4ecd8"/><g stroke="#6b5b3e" stroke-width="2" fill="none">
<rect x="60" y="60" width="880" height="580"/><path d="M60 330 H940 M500 60 V640 M60 200 H500 M500 470 H940"/>
<path d="M180 60 V330 M320 60 V330 M640 330 V640 M790 330 V640" stroke-dasharray="6 4"/></g>
<g fill="#6b5b3e" font-family="serif" font-size="18"><text x="80" y="95">Sy. No. 112</text><text x="200" y="260">112/2A</text>
<text x="360" y="150">113</text><text x="560" y="180">114/1</text><text x="540" y="420">115</text><text x="700" y="520">116/3</text>
<text x="820" y="620">N ↑</text><text x="380" y="690" font-size="14">VILLAGE MAP — SEETHAMMADHARA (scan, 1986)</text></g></svg>`;
EXTRA_SOURCES.push({
  id: 'src-1-scanmap', type: 'cadastral', ward_id: '1', original_name: 'village_map_seethammadhara_1986.png', status: 'needs_georef', crs: null,
  captured_at: '1986-01-01T00:00:00.000Z', scanned: false, created_at: iso(5 * 3600e3), error: null,
  metadata: { preview_key: 'previews/src-1-scanmap.png', image_width: 2000, image_height: 1400, preview_width: 1000, preview_height: 700 },
  preview_url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
});

// A completed epoch comparison for ward 1 (others are run on demand).
export function materializeChanges(run) {
  const templates = EXPECTED_CHANGES[run.ward_id] ?? [];
  const rows = templates.map((c) => ({
    id: id('chg'), run_id: run.id, ward_id: run.ward_id, change_type: c.change_type,
    area_before: c.area_before != null ? round(c.area_before) : null, area_after: c.area_after != null ? round(c.area_after) : null,
    height_before: c.height_before ?? null, height_after: c.height_after ?? null,
    confidence: c.change_type === 'demolished' ? 0.8 : c.change_type === 'new_structure' ? 0.81 : 0.88,
    status: 'pending', geometry: c.geom, geometry_before: c.before, created_at: new Date().toISOString(),
  }));
  CHANGE_DETECTIONS.push(...rows);
  run.summary = rows.reduce((s, r) => ({ ...s, [r.change_type]: (s[r.change_type] ?? 0) + 1 }), {});
  run.status = 'done';
  run.finished_at = new Date().toISOString();
  return rows;
}
const seedRun = {
  id: id('crun'), ward_id: '1', baseline_source_id: 'src-1-building_footprint', current_source_id: 'src-1-ai_extracted',
  baseline_name: 'ward1_footprints_survey_2023.geojson', current_name: 'ai_footprints_ndsm_ward1_ori_latest.geojson',
  baseline_captured: '2023-03-15T00:00:00.000Z', current_captured: iso(90 * 864e5),
  params: { areaChangePct: 15, heightChangeM: 2.5 }, status: 'queued', summary: {}, error: null, created_at: iso(2 * 3600e3),
};
CHANGE_RUNS.push(seedRun);
materializeChanges(seedRun);

AUDIT.push(
  { id: id('aud'), actor_email: 'dev@local', action: 'extraction.run', entity: 'data_sources:src-1-ori', detail: { method: 'auto' }, created_at: iso(2 * 864e5) },
  { id: id('aud'), actor_email: 'dev@local', action: 'changes.run', entity: `change_runs:${seedRun.id}`, detail: { wardId: '1' }, created_at: iso(2 * 3600e3) },
  { id: id('aud'), actor_email: 'system', action: 'source.register', entity: 'data_sources:src-1-scanmap', detail: { type: 'cadastral' }, created_at: iso(5 * 3600e3) },
);
