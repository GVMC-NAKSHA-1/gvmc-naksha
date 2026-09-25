// In-browser demo dataset for VITE_MOCK=true. Shapes follow the NestJS backend responses, and
// matches / conflicts / golden records are derived with the same rules as the Python worker.

export const WARDS = [
  { id: '1', name: 'Seethammadhara', bbox: { north: 17.745, south: 17.73, east: 83.31, west: 83.293 } },
  { id: '2', name: 'Gopalapatnam', bbox: { north: 17.76, south: 17.745, east: 83.212, west: 83.195 } },
  { id: '3', name: 'Maddilapalem', bbox: { north: 17.738, south: 17.725, east: 83.325, west: 83.312 } },
  { id: '4', name: 'Asilmetta', bbox: { north: 17.725, south: 17.713, east: 83.318, west: 83.305 } },
  { id: '5', name: 'Dwaraka Nagar', bbox: { north: 17.73, south: 17.718, east: 83.3, west: 83.287 } },
];

// Deterministic pseudo-random so the demo is identical on every load.
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

const M_LAT = 1 / 110574;                       // degrees per metre
const M_LON = 1 / (111320 * Math.cos((17.73 * Math.PI) / 180));
const rect = (lon, lat, wM, hM) => [[
  [lon, lat], [lon + wM * M_LON, lat], [lon + wM * M_LON, lat + hM * M_LAT], [lon, lat + hM * M_LAT], [lon, lat],
]];
const centroid = (ring) => {
  const pts = ring[0].slice(0, -1);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
};

const OWNERS = ['K. Srinivasa Rao', 'P. Lakshmi', 'M. Venkata Ramana', 'G. Anitha', 'B. Suresh Kumar', 'Ch. Padma', 'V. Ravi Teja', 'S. Durga Prasad', 'T. Madhavi', 'N. Appala Naidu', 'R. Sailaja', 'D. Ganesh'];
const LAND_USE = ['residential', 'residential', 'residential', 'commercial', 'mixed_use', 'institutional'];

export const RELIABILITY = {
  gnss_cors: 1.0, cadastral: 0.95, ground_truth: 0.9, building_footprint: 0.8,
  municipal_gis: 0.8, utility: 0.75, ori: 0.7, dsm_dtm: 0.7, revenue: 0.65, drone_imagery: 0.6,
};

const now = Date.now();
const daysAgo = (d) => new Date(now - d * 864e5).toISOString();

export const SOURCES = [];
export const FEATURES = {};   // sourceId -> Feature[]
export const MATCHES = [];
export const CONFLICTS = [];
export const HARMONIZED = [];
export const MAPPINGS = [];

let fid = 0;
const nextId = (p) => `${p}-${String(++fid).padStart(5, '0')}`;

function addSource(wardId, type, name, features, extra = {}) {
  const id = `src-${wardId}-${type}${extra.suffix ?? ''}`;
  const fields = [...new Set(features.flatMap((f) => Object.keys(f.properties).filter((k) => !k.startsWith('_'))))];
  SOURCES.push({
    id, type, ward_id: wardId, original_name: name, status: extra.status ?? 'ready', crs: extra.crs ?? 'EPSG:4326',
    captured_at: extra.captured ?? daysAgo(30 + Math.floor(rand() * 300)), scanned: Boolean(extra.scanned),
    created_at: daysAgo(Math.floor(rand() * 20)), error: extra.error ?? null,
    metadata: { ...(extra.metadata ?? {}), ...(features.length ? { fields, feature_count: features.length } : {}) },
  });
  FEATURES[id] = features;
  return id;
}

function confidence(score, a, b) {
  const geometric = score / 100;
  const reliability = (RELIABILITY[a] + RELIABILITY[b]) / 2;
  return {
    geometric_match_score: round(geometric, 4), attribute_match_score: 0.5,
    source_reliability_weight: round(reliability, 4), recency_score: 1,
  };
}

function addMatch(wardId, fa, fb, ta, tb, iou, dist) {
  const score = round(100 * (iou != null ? iou : Math.max(0, 1 - dist / 25)), 2);
  const m = {
    id: nextId('m'), ward_id: wardId, feature_a_id: fa.id, feature_b_id: fb.id, source_a_type: ta, source_b_type: tb,
    geometry_iou: iou != null ? round(iou, 4) : null, centroid_distance_m: dist != null ? round(dist, 2) : null,
    match_score: score, confidence_breakdown: confidence(score, ta, tb), matched_at: daysAgo(1),
  };
  MATCHES.push(m);
  return m;
}

// worker/src/harmonize/conflicts.py
function severity(score, ratio, geomBad) {
  if (score < 40 || geomBad) return 'critical';
  if (score < 70) return 'high';
  if (score < 90 || ratio > 0.34) return 'medium';
  return 'low';
}
function detectConflict(m, a, b) {
  const shared = Object.keys(a).filter((k) => k in b && !k.startsWith('_'));
  const disagree = shared.filter((k) => String(a[k]).trim().toLowerCase() !== String(b[k]).trim().toLowerCase());
  const geomBad = m.geometry_iou != null && m.geometry_iou < 0.3;
  if (!disagree.length && !geomBad) return;
  CONFLICTS.push({
    id: nextId('c'), ward_id: m.ward_id, match_id: m.id,
    conflict_type: disagree.length && geomBad ? 'both' : disagree.length ? 'attribute_mismatch' : 'geometry_mismatch',
    severity: severity(m.match_score, disagree.length / Math.max(shared.length, 1), geomBad),
    detail: { disagreeing_fields: disagree, iou: m.geometry_iou },
    suggested_resolution: `Reconcile ${disagree.join(', ') || 'geometry'}; trust the higher-reliability source.`,
    status: 'pending', created_at: daysAgo(rand() * 3),
  });
}

for (const w of WARDS) {
  const { north, south, east, west } = w.bbox;
  const originLon = west + (east - west) * 0.18;
  const originLat = south + (north - south) * 0.22;
  const cad = []; const mun = []; const bld = []; const rev = []; const gt = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const col = i % 4; const row = Math.floor(i / 4);
    const lon = originLon + col * 46 * M_LON;
    const lat = originLat + row * 40 * M_LAT;
    const wM = 34 + rand() * 6; const hM = 28 + rand() * 5;
    const owner = OWNERS[(i + Number(w.id)) % OWNERS.length];
    const survey = `${100 + Number(w.id) * 10 + i}/${pick(['1', '2A', '3B', '4'])}`;
    const khata = `${Number(w.id) * 1000 + 41 + i}`;
    const use = LAND_USE[(i * 5 + Number(w.id)) % LAND_USE.length];
    const area = Math.round(wM * hM);
    const cadGeom = { type: 'Polygon', coordinates: rect(lon, lat, wM, hM) };
    cad.push({ type: 'Feature', id: nextId('f'), geometry: cadGeom, properties: {
      parcel_id: `W${w.id}-P${String(i + 1).padStart(2, '0')}`, survey_no: survey, khata_no: khata, owner_name: owner, land_use: use, area_sqm: area,
      ...(i % 5 === 2 ? { _was_invalid: true } : {}),
    } });

    // Municipal GIS: same parcels digitised separately — small shifts, occasional disagreements.
    const bad = i === 7;                                  // grossly misplaced parcel → geometry conflict
    const shiftM = bad ? 26 : 0.8 + rand() * 3.2;
    const munOwner = i === 3 || i === 10 ? `${owner.split(' ').slice(-1)[0]} (heirs)` : owner;
    const munUse = i === 5 ? 'commercial' : use;
    mun.push({ type: 'Feature', id: nextId('f'), geometry: { type: 'Polygon', coordinates: rect(lon + shiftM * M_LON, lat + shiftM * 0.6 * M_LAT, wM * (0.96 + rand() * 0.08), hM) }, properties: {
      parcel_id: `W${w.id}-P${String(i + 1).padStart(2, '0')}`, survey_no: survey, owner_name: munOwner, land_use: munUse, property_tax_id: `GVMC/${w.id}/${3200 + i}`,
    } });

    if (i % 6 !== 4) {
      const inset = 4 + rand() * 3;
      bld.push({ type: 'Feature', id: nextId('f'), geometry: { type: 'Polygon', coordinates: rect(lon + inset * M_LON, lat + inset * M_LAT, wM - 2 * inset - rand() * 6, hM - 2 * inset - rand() * 4) }, properties: {
        bldg_id: `B-${w.id}-${i + 1}`, floors: 1 + Math.floor(rand() * 4), height_m: round(3.2 + rand() * 10, 1),
      } });
    }
    const c = centroid(cadGeom.coordinates);
    rev.push({ type: 'Feature', id: nextId('f'), geometry: { type: 'Point', coordinates: [c[0] + (rand() - 0.5) * 8 * M_LON, c[1] + (rand() - 0.5) * 8 * M_LAT] }, properties: {
      khata_number: khata, owner: owner.toUpperCase(), extent_sqyd: Math.round(area * 1.196), mutation_year: 2014 + Math.floor(rand() * 10),
    } });
    if (i % 2 === 0) {
      gt.push({ type: 'Feature', id: nextId('f'), geometry: { type: 'Point', coordinates: [c[0] + (rand() - 0.5) * 16 * M_LON, c[1] + (rand() - 0.5) * 16 * M_LAT] }, properties: {
        name: `GT-${w.id}-${i + 1}`, ele: round(18 + rand() * 30, 1), surveyor: pick(['Team A', 'Team B']),
      } });
    }
  }

  const bboxPoly = (padM = 0) => ({ type: 'Polygon', coordinates: [[
    [west - padM * M_LON, south - padM * M_LAT], [east + padM * M_LON, south - padM * M_LAT],
    [east + padM * M_LON, north + padM * M_LAT], [west - padM * M_LON, north + padM * M_LAT], [west - padM * M_LON, south - padM * M_LAT],
  ]] });
  const midLat = originLat + 60 * M_LAT;
  const utility = [
    { type: 'Feature', id: nextId('f'), geometry: { type: 'LineString', coordinates: [[originLon - 20 * M_LON, originLat - 6 * M_LAT], [originLon + 200 * M_LON, originLat - 6 * M_LAT]] }, properties: { asset_id: `WM-${w.id}-01`, network: 'water', material: 'DI', diameter_mm: 300 } },
    { type: 'Feature', id: nextId('f'), geometry: { type: 'LineString', coordinates: [[originLon + 88 * M_LON, originLat - 20 * M_LAT], [originLon + 88 * M_LON, midLat + 80 * M_LAT]] }, properties: { asset_id: `SW-${w.id}-02`, network: 'sewer', material: 'RCC', diameter_mm: 450 } },
  ];
  const gnss = [
    { type: 'Feature', id: nextId('f'), geometry: { type: 'Point', coordinates: [west + (east - west) * 0.08, south + (north - south) * 0.1] }, properties: { station: `CORS-VSP-${w.id}A`, accuracy_cm: 1.2, epoch: '2025.4' } },
    { type: 'Feature', id: nextId('f'), geometry: { type: 'Point', coordinates: [west + (east - west) * 0.9, south + (north - south) * 0.85] }, properties: { station: `CORS-VSP-${w.id}B`, accuracy_cm: 1.5, epoch: '2025.4' } },
  ];

  const W = w.id;
  const cadId = addSource(W, 'cadastral', `ward${W}_cadastral_map.shp`, cad, { crs: 'EPSG:32644', captured: daysAgo(900) });
  addSource(W, 'municipal_gis', `gvmc_ward${W}_parcels.geojson`, mun, { captured: daysAgo(200) });
  addSource(W, 'building_footprint', `ward${W}_footprints_survey_2023.geojson`, bld, { captured: '2023-03-15T00:00:00.000Z' });
  const revId = addSource(W, 'revenue', `ward${W}_revenue_register.csv`, rev, { captured: daysAgo(400) });
  addSource(W, 'ground_truth', `ward${W}_field_survey.gpx`, gt, { captured: daysAgo(12) });
  addSource(W, 'gnss_cors', `ward${W}_cors_control.csv`, gnss, { captured: daysAgo(60) });
  addSource(W, 'utility', `ward${W}_water_sewer.geojson`, W === '4' ? [] : utility, W === '4'
    ? { status: 'failed', error: 'Invalid geometry at feature 118: LineString has fewer than 2 points', metadata: {} }
    : { captured: daysAgo(500) });
  addSource(W, 'ori', `ward${W}_ori_2025_10cm.tif`, [{ type: 'Feature', id: nextId('f'), geometry: bboxPoly(20), properties: { bands: 3, res: '0.10 m', dtype: 'uint8' } }], { crs: 'EPSG:32644', captured: daysAgo(90) });
  addSource(W, 'drone_imagery', `ward${W}_drone_flight_07.tif`, [{ type: 'Feature', id: nextId('f'), geometry: bboxPoly(-40), properties: { bands: 4, res: '0.05 m', dtype: 'uint16' } }], { crs: 'EPSG:32644', captured: daysAgo(15) });
  addSource(W, 'dsm_dtm', `ward${W}_dsm_1m.tif`, [{ type: 'Feature', id: nextId('f'), geometry: bboxPoly(10), properties: { bands: 1, res: '1.0 m', dtype: 'float32' } }], { crs: 'EPSG:32644', captured: daysAgo(90) });
  if (W === '1') {
    addSource(W, 'revenue', 'khata_scan_0042.pdf', [], {
      suffix: '-scan', scanned: true, status: 'ready', crs: null,
      metadata: { ocr: { khata_no: '1142/B', owner_name: 'K. Srinivasa Rao', survey_no: '112/2A', area: '212 sq.yd' }, ocr_confidence: { khata_no: 91, owner_name: 84, survey_no: 79, area: 72 } },
    });
  }
  if (W === '2') addSource(W, 'revenue', 'old_patta_1987.pdf', [], { suffix: '-scan', scanned: true, status: 'pending_ocr', crs: null, metadata: {} });

  MAPPINGS.push(
    { id: nextId('map'), source_a_id: cadId, source_b_id: revId, field_a: 'khata_no', field_b: 'khata_number', confidence: 0.96, rationale: 'Same identifier; suffix differs', approved: true },
    { id: nextId('map'), source_a_id: cadId, source_b_id: revId, field_a: 'owner_name', field_b: 'owner', confidence: 0.92, rationale: 'Owner name, upper-cased in revenue register', approved: true },
    { id: nextId('map'), source_a_id: cadId, source_b_id: revId, field_a: 'area_sqm', field_b: 'extent_sqyd', confidence: 0.71, rationale: 'Parcel extent; unit conversion sq.yd → m² needed', approved: true },
  );

  // Matching + conflicts + golden records, cluster per cadastral parcel.
  cad.forEach((p, i) => {
    const members = [p];
    const scores = [];
    const matchIds = [];
    const push = (f, type, iou, dist) => {
      const m = addMatch(W, p, f, 'cadastral', type, iou, dist);
      detectConflict(m, p.properties, f.properties);
      members.push(f); scores.push(m.match_score); matchIds.push(m.id);
    };
    const bad = i === 7;
    push(mun[i], 'municipal_gis', bad ? 0.22 : 0.84 + rand() * 0.14, null);
    const b = bld.find((x) => x.properties.bldg_id === `B-${W}-${i + 1}`);
    if (b) push(b, 'building_footprint', 0.38 + rand() * 0.25, null);
    push(rev[i], 'revenue', null, 1 + rand() * 6);
    const g = gt.find((x) => x.properties.name === `GT-${W}-${i + 1}`);
    if (g) push(g, 'ground_truth', null, 2 + rand() * 10);

    const attrs = {}; const prov = {};
    const rename = { khata_number: 'khata_no', owner: 'owner_name', extent_sqyd: 'area_sqyd' };
    const typeOf = (f) => (f === p ? 'cadastral' : f === mun[i] ? 'municipal_gis' : f === b ? 'building_footprint' : f === rev[i] ? 'revenue' : 'ground_truth');
    [...members].sort((x, y) => RELIABILITY[typeOf(y)] - RELIABILITY[typeOf(x)]).forEach((f) => {
      for (const [k, v] of Object.entries(f.properties)) {
        const key = rename[k] ?? k;
        if (k.startsWith('_') || key in attrs || v == null || v === '') continue;
        attrs[key] = v; prov[key] = typeOf(f);
      }
    });
    HARMONIZED.push({
      id: `hp-${W}-${String(i + 1).padStart(2, '0')}`, ward_id: W, geom_source_type: 'cadastral', geometry: p.geometry,
      attributes: attrs, attribute_provenance: prov, member_feature_ids: members.map((f) => f.id), match_ids: matchIds,
      confidence: round(scores.reduce((s, v) => s + v, 0) / scores.length / 100, 4),
      conflict_count: CONFLICTS.filter((c) => matchIds.includes(c.match_id)).length, assembled_at: daysAgo(1),
    });
  });
}

// ── Change detections (properties table) ────────────────────────────────────
const STATUSES = ['pending', 'pending', 'pending', 'verified', 'underassessed', 'false_positive', 'already_assessed'];
export const PROPERTIES = [];
let pn = 0;
for (const w of WARDS) {
  const k = { 1: 8, 2: 7, 3: 6, 4: 5, 5: 6 }[w.id];
  for (let j = 0; j < k; j++) {
    pn += 1;
    const { north, south, east, west } = w.bbox;
    const conf = round(0.45 + rand() * 0.52);
    const ndbi = round(Math.min(0.42, conf * 0.4 + (rand() - 0.5) * 0.12), 3);
    const type = rand() > 0.4 ? 'new_build' : 'change_of_use';
    const p = {
      id: `${String(pn).padStart(8, '0')}-4e1a-4c2b-9d3f-${String(1000 + pn).padStart(12, '0')}`,
      ward_id: w.id, ward_name: w.name,
      lat: round(south + (north - south) * (0.1 + rand() * 0.8), 6),
      lng: round(west + (east - west) * (0.1 + rand() * 0.8), 6),
      area_sqm: Math.round(60 + rand() * 480), detection_type: type, confidence: conf, ndbi_delta: ndbi,
      confidence_breakdown: {
        ndbi_delta: ndbi, area_delta: round(Math.min(1, conf + (rand() - 0.5) * 0.2), 3), osm_status: round(Math.min(1, conf * 0.95), 3),
        ndvi_drop: round(Math.min(1, conf * 0.8 + rand() * 0.1), 3), db_match: round(Math.max(0, 1 - conf * 0.7), 3),
      },
      detected_at: daysAgo(pn * 0.3), status: STATUSES[pn % STATUSES.length], baseline_year: 2022, comparison_year: 2025, ai_explanation: null,
    };
    PROPERTIES.push(p);
  }
}

export const CHAT_ANSWERS = [
  'Start with **critical conflicts** — they are usually a misplaced parcel (IoU < 0.30) where the municipal layer and cadastral map disagree. Keep the cadastral geometry (higher reliability) unless ground truth says otherwise.',
  'Upload order that works well: **cadastral → municipal GIS → building footprints → revenue → ground truth**. Then run harmonization; matching, conflict detection and golden-record assembly happen automatically.',
  'The confidence score is **0.4 × geometric match + 0.3 × attribute agreement + 0.2 × source reliability + 0.1 recency**. GNSS/CORS and cadastral sources carry the highest reliability.',
  'Revenue registers use different field names (e.g. `khata_number`, `owner`). Use **Attribute mapping** to let the AI align them with the cadastral schema before assembling golden records.',
  'Scanned revenue PDFs are digitised with OCR; each extracted field keeps its OCR confidence so low-confidence values can be checked before they enter the golden record.',
];
