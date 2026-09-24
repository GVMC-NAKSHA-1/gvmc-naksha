import { HttpResponse, delay, http } from 'msw';
import {
  ALERTS, BRIEF, CHAT_ANSWERS, CONFLICTS, MATCHES, PROPERTIES, SOURCES, TICKETS, WARDS,
} from './data';

// Mutable in-session copies so verify / resolve / review persist until reload.
const db = {
  properties: structuredClone(PROPERTIES),
  alerts: structuredClone(ALERTS),
  tickets: structuredClone(TICKETS),
  sources: structuredClone(SOURCES),
  conflicts: structuredClone(CONFLICTS),
  config: { data_mode: 'demo', pipeline_status: 'idle', last_refresh: '2026-07-30T04:00:00Z', ndbi_threshold: 0.15 },
};

const wait = (min = 200, max = 700) => delay(min + Math.random() * (max - min));
const wardName = (id) => WARDS.find((w) => w.id === String(id))?.name ?? `Ward ${id}`;

function computeStats(wardId) {
  const ps = wardId ? db.properties.filter((p) => p.ward_id === String(wardId)) : db.properties;
  const pendingish = (p) => p.status === 'pending' || p.status === 'underassessed';
  return {
    total_detections: ps.length,
    new_builds: ps.filter((p) => p.detection_type === 'new_build').length,
    change_of_use: ps.filter((p) => p.detection_type === 'change_of_use').length,
    pending_verification: ps.filter((p) => p.status === 'pending').length,
    verified: ps.filter((p) => p.status === 'verified').length,
    false_positives: ps.filter((p) => p.status === 'false_positive').length,
    revenue_estimate: ps.filter(pendingish).reduce((s, p) => s + p.area_sqm * (p.detection_type === 'new_build' ? 80 : 40), 0),
    ward_id: wardId ?? null,
    ...db.config,
  };
}

// Passes through tile / font / external requests untouched (only /api/* is handled).
export const handlers = [
  http.get('*/api/wards', async () => {
    await wait();
    return HttpResponse.json(WARDS.map((w) => ({
      ...w, geojson_r2: null, detection_count: db.properties.filter((p) => p.ward_id === w.id).length,
    })));
  }),

  http.get('*/api/wards/:id/unassessed', async ({ params, request }) => {
    await wait(300, 900);
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    const status = url.searchParams.get('status');
    const year = Number(url.searchParams.get('comparison_year')) || 2024;
    const rows = db.properties
      .filter((p) => p.ward_id === params.id && (!type || p.detection_type === type) && (!status || p.status === status))
      .map((p) => ({ ...p, comparison_year: year }))
      .sort((a, b) => b.confidence - a.confidence);
    return HttpResponse.json(rows);
  }),

  http.get('*/api/wards/:id/alerts', async ({ params }) => {
    await wait();
    return HttpResponse.json(db.alerts.filter((a) => a.ward_id === params.id).sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }),

  http.get('*/api/wards/:id/geojson', async ({ params }) => {
    await wait(400, 1200);
    const features = db.properties.filter((p) => p.ward_id === params.id).map((p) => {
      const d = Math.sqrt(p.area_sqm) / 2 / 111320;
      return {
        type: 'Feature', id: p.id,
        geometry: { type: 'Polygon', coordinates: [[[p.lng - d, p.lat - d], [p.lng + d, p.lat - d], [p.lng + d, p.lat + d], [p.lng - d, p.lat + d], [p.lng - d, p.lat - d]]] },
        properties: { property_id: p.id, detection_type: p.detection_type, confidence: p.confidence, status: p.status },
      };
    });
    return HttpResponse.json({ type: 'FeatureCollection', features });
  }),

  http.get('*/api/properties/:id/explain', async ({ params }) => {
    await wait(700, 1400);
    const p = db.properties.find((x) => x.id === params.id);
    if (!p) return HttpResponse.json({ message: 'Property not found' }, { status: 404 });
    const text = p.ai_explanation ?? `**Likely ${p.detection_type === 'new_build' ? 'new construction' : 'change of use'}** — ${Math.round(p.confidence * 100)}% confidence.\n\n- NDBI Δ ${p.confidence_breakdown.ndbi_delta.toFixed(2)} since ${p.baseline_year}.\n- Not yet field-verified.\n\n**Next step:** visit the site and verify.`;
    return HttpResponse.json({ ai_explanation: text });
  }),

  http.get('*/api/properties/:id', async ({ params }) => {
    await wait();
    const p = db.properties.find((x) => x.id === params.id);
    return p ? HttpResponse.json(p) : HttpResponse.json({ message: 'Property not found' }, { status: 404 });
  }),

  http.post('*/api/properties/:id/verify', async ({ params, request }) => {
    await wait(300, 800);
    const { status } = await request.json();
    const p = db.properties.find((x) => x.id === params.id);
    if (!p) return HttpResponse.json({ message: 'Property not found' }, { status: 404 });
    p.status = status;
    return HttpResponse.json({ status });
  }),

  http.get('*/api/stats/all-wards', async () => {
    await wait(300, 900);
    const wards = WARDS.map((w) => {
      const ps = db.properties.filter((p) => p.ward_id === w.id);
      const deltas = ps.map((p) => p.ndbi_delta);
      const t = db.tickets.filter((x) => x.ward_id === w.id);
      return {
        ward_id: w.id, ward_name: w.name,
        total_detections: ps.length,
        unassessed_count: ps.filter((p) => p.status === 'pending' || p.status === 'underassessed').length,
        open_tickets: t.filter((x) => x.status !== 'resolved').length,
        resolved_tickets: t.filter((x) => x.status === 'resolved').length,
        avg_ndbi_delta: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null,
        max_ndbi_delta: deltas.length ? Math.max(...deltas) : null,
      };
    });
    return HttpResponse.json({ wards, ai_brief: null, totals: computeStats() });
  }),

  http.get('*/api/stats', async ({ request }) => {
    await wait(300, 900);
    return HttpResponse.json(computeStats(new URL(request.url).searchParams.get('ward_id')));
  }),

  http.get('*/api/brief', async () => {
    await wait(900, 1400);
    return HttpResponse.json({ ai_brief: BRIEF, generated_at: new Date().toISOString() });
  }),

  http.post('*/api/chat', async ({ request }) => {
    await wait(700, 1300);
    const { message } = await request.json();
    return HttpResponse.json({ response: CHAT_ANSWERS[String(message).length % CHAT_ANSWERS.length] });
  }),

  http.post('*/api/alerts/generate', async ({ request }) => {
    await wait(900, 1400);
    const { wardId } = await request.json();
    const pending = db.properties.filter((p) => p.ward_id === String(wardId) && p.status === 'pending').length;
    const severity = pending >= 3 ? 'danger' : pending >= 1 ? 'warning' : 'info';
    const row = {
      id: `al-gen-${Date.now()}`, ward_id: String(wardId), severity, score: pending * 20,
      text: `${wardName(wardId)}: ${pending} unverified detections pending field visit. ${severity === 'danger' ? 'Escalate — activity is well above baseline.' : 'Activity within the normal range.'}`,
      created_at: new Date().toISOString(),
    };
    db.alerts.unshift(row);
    return HttpResponse.json(row);
  }),

  http.post('*/api/alerts/export', async ({ request }) => {
    await wait(500, 1000);
    const wardId = new URL(request.url).searchParams.get('ward_id');
    const rows = wardId ? db.properties.filter((p) => p.ward_id === wardId) : db.properties;
    const csv = ['id,ward_id,type,confidence,status', ...rows.map((p) => `${p.id},${p.ward_id},${p.detection_type},${p.confidence},${p.status}`)].join('\n');
    return HttpResponse.json({ presigned_url: `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`, row_count: rows.length });
  }),

  // ── Tickets ──
  http.get('*/api/tickets', async ({ request }) => {
    await wait();
    const url = new URL(request.url);
    const wardId = url.searchParams.get('wardId');
    const status = url.searchParams.get('status');
    const tickets = db.tickets
      .filter((t) => (!wardId || t.ward_id === wardId) && (!status || t.status === status))
      .map((t) => ({ ...t, ward_name: wardName(t.ward_id) }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return HttpResponse.json({ tickets });
  }),

  http.post('*/api/tickets/photo-upload', async ({ request }) => {
    await wait();
    const { filename } = await request.json();
    return HttpResponse.json({ upload_url: '/__mock_upload__', r2_key: `uploads/tickets/${Date.now()}-${filename}` });
  }),
  http.put('*/__mock_upload__', async () => { await wait(); return new HttpResponse(null, { status: 200 }); }),

  http.get('*/api/tickets/:id', async ({ params }) => {
    await wait();
    const t = db.tickets.find((x) => x.id === params.id);
    return t ? HttpResponse.json({ ticket: { ...t, ward_name: wardName(t.ward_id) } }) : HttpResponse.json({ message: 'Ticket not found' }, { status: 404 });
  }),

  http.post('*/api/tickets', async ({ request }) => {
    await wait(300, 800);
    const b = await request.json();
    if (!b.wardId || !b.houseNumber || !b.description) return HttpResponse.json({ message: 'wardId, houseNumber and description are required' }, { status: 400 });
    const row = {
      id: `tk-${Date.now()}`, ward_id: String(b.wardId), property_id: b.propertyId ?? null, house_number: b.houseNumber,
      description: b.description, tax_pending: b.taxPending ?? null, photo_r2_key: b.photoR2Key ?? null,
      status: 'open', supervisor_notes: '', created_at: new Date().toISOString(),
    };
    db.tickets.unshift(row);
    return HttpResponse.json({ id: row.id, status: row.status }, { status: 201 });
  }),

  http.patch('*/api/tickets/:id/review', async ({ params, request }) => {
    await wait(300, 800);
    const b = await request.json();
    const t = db.tickets.find((x) => x.id === params.id);
    if (!t) return HttpResponse.json({ message: 'Ticket not found' }, { status: 404 });
    Object.assign(t, { status: b.status, supervisor_notes: b.supervisorNotes ?? '', reviewed_by: b.reviewedBy ?? 'supervisor', reviewed_at: new Date().toISOString() });
    return HttpResponse.json({ status: b.status });
  }),

  // ── Integration ──
  http.get('*/api/sources', async ({ request }) => {
    await wait();
    const url = new URL(request.url);
    const wardId = url.searchParams.get('wardId');
    const type = url.searchParams.get('type');
    return HttpResponse.json(db.sources.filter((s) => (!wardId || s.ward_id === wardId || s.ward_id == null) && (!type || s.type === type)));
  }),

  http.post('*/api/sources/upload', async ({ request }) => {
    await wait(400, 900);
    const b = await request.json();
    const id = `src-${Date.now()}`;
    db.sources.unshift({ id, type: b.type, ward_id: b.wardId ?? null, original_name: b.originalName, status: b.scanned ? 'pending_ocr' : 'processing', crs: b.crs ?? null, metadata: {} });
    return HttpResponse.json({ sourceId: id, uploadUrl: '/__mock_upload__', status: 'processing', jobId: `job-${id}` }, { status: 202 });
  }),

  http.post('*/api/harmonization/run', async ({ request }) => {
    await wait(800, 1400);
    const wardId = new URL(request.url).searchParams.get('wardId');
    const wards = wardId ? [wardId] : WARDS.map((w) => w.id);
    return HttpResponse.json({ status: 'processing', jobs: wards.map((w) => `job-harmonize-${w}`) }, { status: 202 });
  }),

  http.get('*/api/harmonization/matches', async ({ request }) => {
    await wait();
    const url = new URL(request.url);
    const wardId = url.searchParams.get('wardId');
    const min = Number(url.searchParams.get('minScore') ?? 0);
    return HttpResponse.json(MATCHES.filter((m) => (!wardId || m.ward_id === wardId) && m.match_score >= min));
  }),

  http.get('*/api/conflicts', async ({ request }) => {
    await wait();
    const url = new URL(request.url);
    const wardId = url.searchParams.get('wardId');
    const status = url.searchParams.get('status');
    return HttpResponse.json(db.conflicts.filter((c) => (!wardId || c.ward_id === wardId) && (!status || c.status === status)));
  }),

  http.post('*/api/conflicts/:id/resolve', async ({ params, request }) => {
    await wait();
    const b = await request.json();
    const c = db.conflicts.find((x) => x.id === params.id);
    if (!c) return HttpResponse.json({ message: 'Conflict not found' }, { status: 404 });
    Object.assign(c, { status: b.status, resolved_by: b.resolvedBy ?? 'officer', resolved_at: new Date().toISOString() });
    return HttpResponse.json({ id: c.id, status: c.status });
  }),

  http.get('*/api/harmonized/export', async ({ request }) => {
    await wait(500, 1000);
    const wardId = new URL(request.url).searchParams.get('wardId');
    const features = db.properties.filter((p) => p.ward_id === wardId).map((p) => ({
      type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { ward_id: p.ward_id, status: p.status, area_sqm: p.area_sqm },
    }));
    return HttpResponse.json({ type: 'FeatureCollection', features });
  }),

  // ── Admin ──
  http.post('*/api/admin/upload-csv', async ({ request }) => {
    await wait(800, 1400);
    const { fileContent } = await request.json();
    const rows = Math.max(0, atob(fileContent || '').split('\n').filter((l) => l.trim()).length - 1);
    db.config.data_mode = 'live';
    return HttpResponse.json({ properties_imported: rows });
  }),

  http.post('*/api/admin/db-config', async ({ request }) => {
    await wait();
    const b = await request.json();
    if (b.ndbi_threshold != null) db.config.ndbi_threshold = Number(b.ndbi_threshold);
    return HttpResponse.json({});
  }),

  http.post('*/api/admin/refresh', async () => {
    await wait();
    db.config.pipeline_status = 'running';
    setTimeout(() => {
      db.config.pipeline_status = 'completed';
      db.config.last_refresh = new Date().toISOString();
    }, 12000);
    return HttpResponse.json({ triggered: true, jobs: WARDS.length }, { status: 202 });
  }),
];
