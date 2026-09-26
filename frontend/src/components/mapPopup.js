// HTML helpers for MapLibre popups (kept apart from GeoMap so pages can use them without
// pulling MapLibre into their chunk).

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Default popup: the feature's attributes (internal `_` keys hidden). */
export function propsTable(title, props, limit = 10) {
  const rows = Object.entries(props ?? {})
    .filter(([k, v]) => !k.startsWith('_') && v !== null && v !== '' && typeof v !== 'object')
    .slice(0, limit)
    .map(([k, v]) => `<tr><td style="color:#5b6573;padding-right:8px">${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join('');
  return `<strong>${esc(title)}</strong>${rows ? `<table style="margin-top:4px">${rows}</table>` : ''}`;
}
