import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { asList, cleanParams, errorMessage } from '../../api/client';

// Validation & synchronisation, multi-epoch change detection, finalisation readiness, OGC exchange.

export const mapReport = (r) => ({
  id: String(r.id),
  wardId: r.ward_id ?? null,
  sourceId: r.source_id ?? null,
  sourceType: r.source_type ?? null,
  sourceName: r.source_name ?? null,
  score: Number(r.score ?? 0),
  checks: (r.checks ?? []).map((c) => ({ ...c, value: Number(c.value) })),
  createdAt: r.created_at,
});

export const mapChangeRun = (r) => ({
  id: String(r.id),
  wardId: r.ward_id ?? null,
  baselineSourceId: r.baseline_source_id,
  currentSourceId: r.current_source_id,
  baselineName: r.baseline_name ?? null,
  currentName: r.current_name ?? null,
  baselineCaptured: r.baseline_captured ?? null,
  currentCaptured: r.current_captured ?? null,
  params: r.params ?? {},
  status: r.status,
  summary: r.summary ?? {},
  error: r.error ?? null,
  createdAt: r.created_at,
});

export const mapChange = (c) => ({
  id: String(c.id),
  runId: String(c.run_id),
  wardId: c.ward_id ?? null,
  changeType: c.change_type,
  areaBefore: c.area_before != null ? Number(c.area_before) : null,
  areaAfter: c.area_after != null ? Number(c.area_after) : null,
  heightBefore: c.height_before != null ? Number(c.height_before) : null,
  heightAfter: c.height_after != null ? Number(c.height_after) : null,
  confidence: Number(c.confidence ?? 0),
  status: c.status ?? 'pending',
  geometry: c.geometry ?? null,
  geometryBefore: c.geometry_before ?? null,
});

// ── validation ──
export const runValidation = createAsyncThunk('quality/runValidation', async (wardId, { rejectWithValue }) => {
  try { return (await api.post('/api/validation/run', { wardId })).data; } catch (err) { return rejectWithValue(errorMessage(err)); }
});
export const fetchReports = createAsyncThunk('quality/fetchReports', async (wardId, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/validation/reports', { params: cleanParams({ wardId }) });
    return asList(data, 'reports').map(mapReport);
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});
export const fetchFindings = createAsyncThunk('quality/fetchFindings', async (wardId, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/validation/findings', { params: cleanParams({ wardId }) });
    return data?.type === 'FeatureCollection' ? data : { type: 'FeatureCollection', features: [] };
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});

// ── change detection ──
export const runChangeDetection = createAsyncThunk('quality/runChangeDetection', async (body, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/api/changes/run', body);
    return { run: mapChangeRun(data.run), jobId: data.jobId };
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});
export const fetchChangeRuns = createAsyncThunk('quality/fetchChangeRuns', async (wardId, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/changes/runs', { params: cleanParams({ wardId }) });
    return asList(data, 'runs').map(mapChangeRun);
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});
export const fetchChanges = createAsyncThunk('quality/fetchChanges', async ({ runId, wardId } = {}, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/changes', { params: cleanParams({ runId, wardId }) });
    return asList(data, 'changes').map(mapChange);
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});
export const verifyChange = createAsyncThunk('quality/verifyChange', async ({ id, status }, { rejectWithValue }) => {
  try {
    await api.post(`/api/changes/${id}/verify`, { status });
    return { id: String(id), status };
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});

// ── finalisation readiness + OGC exchange ──
export const fetchReadiness = createAsyncThunk('quality/fetchReadiness', async (wardId, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/harmonized/readiness', { params: cleanParams({ wardId }) });
    return data;
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});
export const fetchCollections = createAsyncThunk('quality/fetchCollections', async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/ogc/collections');
    return data?.collections ?? [];
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});
export const fetchCollectionItems = createAsyncThunk('quality/fetchCollectionItems', async ({ id, wardId, limit = 500 }, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/api/ogc/collections/${id}/items`, { params: cleanParams({ wardId, limit }) });
    return { id, fc: data };
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});

const slice = createSlice({
  name: 'quality',
  initialState: {
    reports: [], reportsStatus: 'idle', findings: null, validateStatus: 'idle', validateError: null,
    changeRuns: [], changeRunsStatus: 'idle', changes: [], changesStatus: 'idle', changeRunStatus: 'idle', changeRunError: null,
    readiness: null, readinessStatus: 'idle',
    collections: [], collectionsStatus: 'idle', items: null, itemsStatus: 'idle',
  },
  reducers: {
    resetValidate(s) { s.validateStatus = 'idle'; s.validateError = null; s.changeRunStatus = 'idle'; s.changeRunError = null; },
  },
  extraReducers: (b) => {
    b.addCase(runValidation.pending, (s) => { s.validateStatus = 'loading'; s.validateError = null; })
      .addCase(runValidation.fulfilled, (s) => { s.validateStatus = 'succeeded'; })
      .addCase(runValidation.rejected, (s, a) => { s.validateStatus = 'failed'; s.validateError = a.payload; })
      .addCase(fetchReports.pending, (s) => { if (s.reportsStatus === 'idle') s.reportsStatus = 'loading'; })
      .addCase(fetchReports.fulfilled, (s, a) => { s.reportsStatus = 'succeeded'; s.reports = a.payload; })
      .addCase(fetchReports.rejected, (s) => { s.reportsStatus = 'failed'; })
      .addCase(fetchFindings.fulfilled, (s, a) => { s.findings = a.payload; })

      .addCase(runChangeDetection.pending, (s) => { s.changeRunStatus = 'loading'; s.changeRunError = null; })
      .addCase(runChangeDetection.fulfilled, (s, a) => { s.changeRunStatus = 'succeeded'; s.changeRuns.unshift(a.payload.run); })
      .addCase(runChangeDetection.rejected, (s, a) => { s.changeRunStatus = 'failed'; s.changeRunError = a.payload; })
      .addCase(fetchChangeRuns.pending, (s) => { if (s.changeRunsStatus === 'idle') s.changeRunsStatus = 'loading'; })
      .addCase(fetchChangeRuns.fulfilled, (s, a) => { s.changeRunsStatus = 'succeeded'; s.changeRuns = a.payload; })
      .addCase(fetchChangeRuns.rejected, (s) => { s.changeRunsStatus = 'failed'; })
      .addCase(fetchChanges.pending, (s) => { s.changesStatus = 'loading'; })
      .addCase(fetchChanges.fulfilled, (s, a) => { s.changesStatus = 'succeeded'; s.changes = a.payload; })
      .addCase(fetchChanges.rejected, (s) => { s.changesStatus = 'failed'; })
      .addCase(verifyChange.fulfilled, (s, a) => {
        const c = s.changes.find((x) => x.id === a.payload.id);
        if (c) c.status = a.payload.status;
      })

      .addCase(fetchReadiness.pending, (s) => { s.readinessStatus = 'loading'; })
      .addCase(fetchReadiness.fulfilled, (s, a) => { s.readinessStatus = 'succeeded'; s.readiness = a.payload; })
      .addCase(fetchReadiness.rejected, (s) => { s.readinessStatus = 'failed'; s.readiness = null; })
      .addCase(fetchCollections.pending, (s) => { s.collectionsStatus = 'loading'; })
      .addCase(fetchCollections.fulfilled, (s, a) => { s.collectionsStatus = 'succeeded'; s.collections = a.payload; })
      .addCase(fetchCollections.rejected, (s) => { s.collectionsStatus = 'failed'; })
      .addCase(fetchCollectionItems.pending, (s) => { s.itemsStatus = 'loading'; })
      .addCase(fetchCollectionItems.fulfilled, (s, a) => { s.itemsStatus = 'succeeded'; s.items = a.payload; })
      .addCase(fetchCollectionItems.rejected, (s) => { s.itemsStatus = 'failed'; s.items = null; });
  },
});

export const { resetValidate } = slice.actions;

export const selectReports = (s) => s.quality.reports;
export const selectReportsStatus = (s) => s.quality.reportsStatus;
export const selectFindings = (s) => s.quality.findings;
export const selectValidateStatus = (s) => s.quality.validateStatus;
export const selectValidateError = (s) => s.quality.validateError;
export const selectChangeRuns = (s) => s.quality.changeRuns;
export const selectChanges = (s) => s.quality.changes;
export const selectChangesStatus = (s) => s.quality.changesStatus;
export const selectChangeRunStatus = (s) => s.quality.changeRunStatus;
export const selectChangeRunError = (s) => s.quality.changeRunError;
export const selectReadiness = (s) => s.quality.readiness;
export const selectCollections = (s) => s.quality.collections;
export const selectCollectionsStatus = (s) => s.quality.collectionsStatus;
export const selectCollectionItems = (s) => s.quality.items;
export const selectItemsStatus = (s) => s.quality.itemsStatus;

export default slice.reducer;
