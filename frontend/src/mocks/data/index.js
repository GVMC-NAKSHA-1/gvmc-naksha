// In-browser demo dataset for VITE_MOCK=true. Shapes follow the NestJS backend responses.

export const WARDS = [
  { id: '1', name: 'Seethammadhara', bbox: { north: 17.745, south: 17.715, east: 83.315, west: 83.28 } },
  { id: '2', name: 'Gopalapatnam', bbox: { north: 17.778, south: 17.748, east: 83.278, west: 83.245 } },
  { id: '3', name: 'Maddilapalem', bbox: { north: 17.742, south: 17.722, east: 83.335, west: 83.312 } },
  { id: '4', name: 'Asilmetta', bbox: { north: 17.728, south: 17.71, east: 83.322, west: 83.3 } },
  { id: '5', name: 'Dwaraka Nagar', bbox: { north: 17.735, south: 17.715, east: 83.305, west: 83.285 } },
];

// Deterministic pseudo-random so the demo looks the same each load.
let seed = 42;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const jitter = (v, amt = 0.15) => Math.max(0, Math.min(1, v + (rand() - 0.5) * 2 * amt));

const EXPLAIN = (p) => `**${p.detection_type === 'new_build' ? 'New construction' : 'Change of use'} detected** with ${Math.round(p.confidence * 100)}% confidence.

- NDBI rose by **${p.confidence_breakdown.ndbi_delta.toFixed(2)}** between ${p.baseline_year} and ${p.comparison_year}, indicating new built-up surface.
- Footprint of ~${Math.round(p.area_sqm)} m² is ${p.confidence_breakdown.db_match < 0.5 ? '**not** matched' : 'partially matched'} to the GVMC assessment register.
- Vegetation loss signal: ${Math.round(p.confidence_breakdown.ndvi_drop * 100)}%.

**Recommended:** field verification and reassessment of property tax.`;

function makeProperty(n, wardId, lat, lng, type, conf, status, areaSqm, cmpYear = 2024) {
  const confidence_breakdown = {
    ndbi_delta: +jitter(conf * 0.4, 0.08).toFixed(3),
    area_delta: +jitter(conf).toFixed(3),
    osm_status: +jitter(conf * 0.9).toFixed(3),
    ndvi_drop: +jitter(conf * 0.8).toFixed(3),
    db_match: +jitter(1 - conf * 0.6).toFixed(3),
  };
  const p = {
    id: `${String(n).padStart(8, '0')}-4e1a-4c2b-9d3f-${String(1000 + n).padStart(12, '0')}`,
    ward_id: wardId,
    ward_name: WARDS.find((w) => w.id === wardId)?.name,
    lat, lng, area_sqm: areaSqm,
    detection_type: type,
    confidence: conf,
    confidence_breakdown,
    ndbi_delta: confidence_breakdown.ndbi_delta,
    detected_at: new Date(Date.now() - n * 36e5 * 7).toISOString(),
    status,
    baseline_year: 2022,
    comparison_year: cmpYear,
    ai_explanation: null,
  };
  if (status !== 'pending') p.ai_explanation = EXPLAIN(p);
  return p;
}

const STATUSES = ['pending', 'pending', 'pending', 'verified', 'underassessed', 'false_positive', 'already_assessed'];
const counts = { 1: 9, 2: 7, 3: 6, 4: 5, 5: 5 };
let n = 0;
export const PROPERTIES = WARDS.flatMap((w) => Array.from({ length: counts[w.id] }, () => {
  n += 1;
  const { north, south, east, west } = w.bbox;
  const lat = +(south + (north - south) * (0.15 + rand() * 0.7)).toFixed(6);
  const lng = +(west + (east - west) * (0.15 + rand() * 0.7)).toFixed(6);
  const type = rand() > 0.4 ? 'new_build' : 'change_of_use';
  const conf = +(0.45 + rand() * 0.52).toFixed(2);
  return makeProperty(n, w.id, lat, lng, type, conf, STATUSES[n % STATUSES.length], Math.round(60 + rand() * 540));
}));

export const ALERTS = WARDS.flatMap((w, i) => [
  { id: `al-${w.id}-1`, ward_id: w.id, severity: 'danger', text: `${counts[w.id]} new structures detected in ${w.name} this week — 2.1× the monthly baseline.`, created_at: new Date(Date.now() - (2 + i) * 36e5).toISOString() },
  { id: `al-${w.id}-2`, ward_id: w.id, severity: 'warning', text: `Cluster of change-of-use detections near the main road in ${w.name}; likely commercial conversions.`, created_at: new Date(Date.now() - (20 + i) * 36e5).toISOString() },
  ...(i % 2 === 0 ? [{ id: `al-${w.id}-3`, ward_id: w.id, severity: 'info', text: `Sentinel-2 composite for ${w.name} refreshed (cloud cover 4%).`, created_at: new Date(Date.now() - 3 * 864e5).toISOString() }] : []),
]);

export const TICKETS = [
  { id: 'tk-0001', ward_id: '1', property_id: PROPERTIES[0].id, house_number: '12-4-56/A', description: 'G+2 structure built on previously vacant plot. No building permission displayed on site.', tax_pending: 25000, status: 'open', supervisor_notes: '', created_at: new Date(Date.now() - 864e5).toISOString() },
  { id: 'tk-0002', ward_id: '2', property_id: PROPERTIES[10].id, house_number: '8-2-110', description: 'Ground floor converted to a retail shop; assessed as residential.', tax_pending: 14200, status: 'under_review', supervisor_notes: 'Revenue inspector to visit on Monday.', created_at: new Date(Date.now() - 3 * 864e5).toISOString() },
  { id: 'tk-0003', ward_id: '3', property_id: null, house_number: '47-11-3', description: 'Additional floor added over the existing structure.', tax_pending: 9800, status: 'resolved', supervisor_notes: 'Reassessed. Notice issued.', created_at: new Date(Date.now() - 9 * 864e5).toISOString() },
  { id: 'tk-0004', ward_id: '1', property_id: PROPERTIES[3].id, house_number: '12-6-21', description: 'Warehouse shed on agricultural land.', tax_pending: null, status: 'open', supervisor_notes: '', created_at: new Date(Date.now() - 2 * 36e5).toISOString() },
];

export const SOURCES = [
  { id: 'src-01', type: 'cadastral', ward_id: '1', original_name: 'seethammadhara_cadastral.geojson', status: 'ready', crs: 'EPSG:4326', metadata: { feature_count: 1432 } },
  { id: 'src-02', type: 'revenue', ward_id: '1', original_name: 'revenue_records_2024.pdf', status: 'pending_ocr', crs: null, metadata: {} },
  { id: 'src-03', type: 'municipal_gis', ward_id: '2', original_name: 'gvmc_parcels_w2.geojson', status: 'ready', crs: 'EPSG:4326', metadata: { feature_count: 988 } },
  { id: 'src-04', type: 'drone_imagery', ward_id: '1', original_name: 'drone_ortho_2026_03.tif', status: 'processing', crs: 'EPSG:32644', metadata: {} },
  { id: 'src-05', type: 'ground_truth', ward_id: '3', original_name: 'field_survey_march.gpx', status: 'ready', crs: 'EPSG:4326', metadata: {} },
  { id: 'src-06', type: 'building_footprint', ward_id: null, original_name: 'footprints_vizag.geojson', status: 'ready', crs: 'EPSG:4326', metadata: { feature_count: 21044 } },
  { id: 'src-07', type: 'utility', ward_id: '4', original_name: 'water_connections.geojson', status: 'failed', crs: null, metadata: { error: 'Invalid geometry at feature 118' } },
  { id: 'src-08', type: 'revenue', ward_id: '5', original_name: 'khata_scan_0042.pdf', status: 'ready', crs: null,
    metadata: { ocr_extracted: { khata_no: { value: '1142/B', confidence: 91 }, owner_name: { value: 'K. Srinivasa Rao', confidence: 84 }, area: { value: '212 sq.yd', confidence: 77 } } } },
];

export const MATCHES = [
  { id: 'm-1', ward_id: '1', source_a_type: 'cadastral', source_b_type: 'municipal_gis', geometry_iou: 0.91, centroid_distance_m: 2.3, match_score: 96.1 },
  { id: 'm-2', ward_id: '1', source_a_type: 'cadastral', source_b_type: 'building_footprint', geometry_iou: 0.84, centroid_distance_m: 4.8, match_score: 88.4 },
  { id: 'm-3', ward_id: '2', source_a_type: 'municipal_gis', source_b_type: 'revenue', geometry_iou: 0.72, centroid_distance_m: 7.9, match_score: 74.2 },
  { id: 'm-4', ward_id: '3', source_a_type: 'ground_truth', source_b_type: 'cadastral', geometry_iou: 0.63, centroid_distance_m: 11.2, match_score: 61.7 },
  { id: 'm-5', ward_id: '1', source_a_type: 'cadastral', source_b_type: 'revenue', geometry_iou: 0.41, centroid_distance_m: 18.5, match_score: 48.9 },
  { id: 'm-6', ward_id: '4', source_a_type: 'utility', source_b_type: 'municipal_gis', geometry_iou: 0.22, centroid_distance_m: 31.0, match_score: 35.8 },
];

export const CONFLICTS = [
  { id: 'c-1', ward_id: '1', match_id: 'm-5', conflict_type: 'geometry_mismatch', severity: 'high', status: 'pending',
    suggested_resolution: 'Cadastral boundary extends 18 m beyond the revenue record — prefer the drone-verified footprint.' },
  { id: 'c-2', ward_id: '2', match_id: 'm-3', conflict_type: 'attribute_mismatch', severity: 'medium', status: 'needs_review',
    suggested_resolution: 'Owner name differs between revenue (OCR) and municipal GIS. Confirm with the latest khata.' },
  { id: 'c-3', ward_id: '4', match_id: 'm-6', conflict_type: 'both', severity: 'critical', status: 'pending',
    suggested_resolution: 'Utility connection maps to a different parcel; possible unauthorised sub-division.' },
];

export const CHAT_ANSWERS = [
  'Ward **1 (Seethammadhara)** has the most pending detections. Start with properties above **80% confidence** — they are the most likely to be real new builds.',
  'To verify a property: select it in the list, review the **confidence breakdown** and the AI analysis, then choose *Verified*, *Underassessed*, *False Positive* or *Already Assessed*.',
  'A **high NDBI delta** (≥ 0.30) means a large increase in built-up surface between the two years — usually a new roof or paved area.',
  'If the owner is not available, **raise a ticket** with the house number and a photograph. Your supervisor will review it.',
  'City-wide, about **38%** of detections are change-of-use cases. These are often ground-floor shops in residential buildings.',
];

export const BRIEF = `### GVMC Daily Detection Brief — ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}

**Headline:** ${PROPERTIES.length} change detections across ${WARDS.length} monitored wards. **${PROPERTIES.filter((p) => p.status === 'pending').length}** still await field verification.

#### Priorities
- **Seethammadhara** leads with the most new builds. Deploy two field teams.
- **Gopalapatnam** shows a cluster of commercial conversions along the NH-16 service road.
- 1 critical harmonization conflict (utility vs municipal GIS) in **Asilmetta**.

| Metric | Value |
|---|---|
| New builds | ${PROPERTIES.filter((p) => p.detection_type === 'new_build').length} |
| Change of use | ${PROPERTIES.filter((p) => p.detection_type === 'change_of_use').length} |
| Open tickets | ${TICKETS.filter((t) => t.status !== 'resolved').length} |
`;
