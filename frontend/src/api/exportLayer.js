import api, { cleanParams } from './client';

export const EXPORT_LAYERS = [
  { value: 'parcels',        label: 'Master parcels' },
  { value: 'conflicts',      label: 'Conflicts' },
  { value: 'source_records', label: 'Source records' },
];

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * GeoJSON export. Master parcels come from the harmonized golden-record endpoint (needs a ward);
 * conflicts / source records are assembled client-side from their list endpoints.
 */
export async function downloadGeoJSON(layer, wardId) {
  let fc;
  if (layer === 'parcels') {
    if (!wardId) throw new Error('Select a ward to export master parcels.');
    const { data } = await api.get('/api/harmonized/export', { params: { wardId, format: 'geojson' } });
    fc = data?.type === 'FeatureCollection' ? data : { type: 'FeatureCollection', features: data?.features ?? [] };
  } else if (layer === 'conflicts') {
    const { data } = await api.get('/api/conflicts', { params: cleanParams({ wardId }) });
    const rows = Array.isArray(data) ? data : data?.conflicts ?? [];
    fc = { type: 'FeatureCollection', features: rows.map((c) => ({ type: 'Feature', id: c.id, geometry: c.geometry ?? null, properties: c })) };
  } else {
    const { data } = await api.get('/api/sources', { params: cleanParams({ wardId }) });
    const rows = Array.isArray(data) ? data : data?.sources ?? [];
    fc = { type: 'FeatureCollection', features: rows.map((s) => ({ type: 'Feature', id: s.id, geometry: s.footprint ?? null, properties: s })) };
  }
  const count = fc.features?.length ?? 0;
  triggerDownload(new Blob([JSON.stringify(fc)], { type: 'application/geo+json' }), `gvmc_${layer}.geojson`);
  return { count, truncated: Boolean(fc.truncated) };
}

/** Opens a presigned URL in a new tab; inline data: URLs (mock mode) are downloaded instead. */
export function openExportUrl(url, filename = 'gvmc_export.csv') {
  if (!url) return;
  if (url.startsWith('data:')) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

/** CSV export: backend writes the file to object storage and returns a presigned URL. */
export async function exportCsv(layer, wardId) {
  const { data } = await api.post('/api/alerts/export', { layer }, { params: cleanParams({ ward_id: wardId }) });
  openExportUrl(data?.presigned_url ?? data?.url, `gvmc_${layer}.csv`);
  return { count: data?.row_count ?? 0 };
}
