import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { asList, cleanParams, errorMessage } from '../../api/client';

// Processing stages: GeoAI feature extraction, topology correction, geo-referencing + CRS.

export const mapRun = (r) => ({
  id: String(r.id),
  wardId: r.ward_id ?? null,
  sourceId: r.source_id,
  sourceName: r.source_name ?? null,
  sourceType: r.source_type ?? null,
  method: r.method,
  methodUsed: r.method_used ?? null,
  params: r.params ?? {},
  status: r.status,
  resultSourceId: r.result_source_id ?? null,
  featureCount: r.feature_count ?? null,
  metrics: r.metrics ?? {},
  error: r.error ?? null,
  createdAt: r.created_at,
  finishedAt: r.finished_at ?? null,
});

export const mapIssue = (i) => ({
  id: String(i.id),
  wardId: i.ward_id ?? null,
  sourceId: i.source_id,
  sourceType: i.source_type ?? null,
  sourceName: i.source_name ?? null,
  issueType: i.issue_type,
  areaSqm: i.area_sqm != null ? Number(i.area_sqm) : null,
  featureIds: i.feature_ids ?? [],
  status: i.status,
  fix: i.fix ?? {},
  geometry: i.geometry ?? null,
  fixedGeometry: i.fixed_geometry ?? null,
  resolvedBy: i.resolved_by ?? null,
  resolvedAt: i.resolved_at ?? null,
});

// ── extraction ──
export const fetchExtractionRuns = createAsyncThunk('processing/fetchExtractionRuns', async (wardId, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/extraction/runs', { params: cleanParams({ wardId }) });
    return asList(data, 'runs').map(mapRun);
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});
export const runExtraction = createAsyncThunk('processing/runExtraction', async ({ sourceId, method, params }, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/api/extraction/run', { sourceId, method, params });
    return { run: mapRun(data.run), jobId: data.jobId };
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});

// ── topology ──
export const fetchTopologyIssues = createAsyncThunk('processing/fetchTopologyIssues', async ({ wardId, sourceId, status } = {}, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/topology/issues', { params: cleanParams({ wardId, sourceId, status }) });
    return asList(data, 'issues').map(mapIssue);
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});
export const runTopology = createAsyncThunk('processing/runTopology', async (body, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/api/topology/run', body);
    return data;
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});
export const resolveIssue = createAsyncThunk('processing/resolveIssue', async ({ id, action }, { rejectWithValue }) => {
  try {
    const { data } = await api.post(`/api/topology/issues/${id}/resolve`, { action });
    return { id: String(id), status: data.status };
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});
export const acceptAllIssues = createAsyncThunk('processing/acceptAllIssues', async (sourceId, { rejectWithValue }) => {
  try {
    const { data } = await api.post(`/api/topology/sources/${sourceId}/accept-all`);
    return data;
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});

// ── geo-referencing + CRS ──
export const fetchCrsList = createAsyncThunk('processing/fetchCrsList', async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/crs');
    return asList(data, 'crs');
  } catch (err) { return rejectWithValue(errorMessage(err)); }
}, { condition: (_, { getState }) => getState().processing.crsList.length === 0 });

export const transformCoordinates = createAsyncThunk('processing/transformCoordinates', async ({ from, to, points }, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/api/crs/transform', { from, to, points });
    return data.points;
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});
export const previewGeoref = createAsyncThunk('processing/previewGeoref', async ({ sourceId, gcps, kind, crs }, { rejectWithValue }) => {
  try {
    const { data } = await api.post(`/api/georef/${sourceId}/preview`, { gcps, kind, crs });
    return data;
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});
export const applyGeoref = createAsyncThunk('processing/applyGeoref', async ({ sourceId, gcps, kind, crs }, { rejectWithValue }) => {
  try {
    const { data } = await api.post(`/api/georef/${sourceId}/apply`, { gcps, kind, crs });
    return data;
  } catch (err) { return rejectWithValue(errorMessage(err)); }
});

const slice = createSlice({
  name: 'processing',
  initialState: {
    runs: [], runsStatus: 'idle', runStatus: 'idle', runError: null,
    issues: [], issuesStatus: 'idle', topoRunStatus: 'idle', topoError: null, resolveError: null,
    crsList: [], transformed: null, transformStatus: 'idle', transformError: null,
    georefPreview: null, georefStatus: 'idle', georefError: null, applyStatus: 'idle',
  },
  reducers: {
    resetGeoref(s) { s.georefPreview = null; s.georefStatus = 'idle'; s.georefError = null; s.applyStatus = 'idle'; },
    resetRun(s) { s.runStatus = 'idle'; s.runError = null; s.topoRunStatus = 'idle'; s.topoError = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchExtractionRuns.pending, (s) => { if (s.runsStatus === 'idle') s.runsStatus = 'loading'; })
      .addCase(fetchExtractionRuns.fulfilled, (s, a) => { s.runsStatus = 'succeeded'; s.runs = a.payload; })
      .addCase(fetchExtractionRuns.rejected, (s) => { s.runsStatus = 'failed'; })
      .addCase(runExtraction.pending, (s) => { s.runStatus = 'loading'; s.runError = null; })
      .addCase(runExtraction.fulfilled, (s, a) => { s.runStatus = 'succeeded'; s.runs.unshift(a.payload.run); })
      .addCase(runExtraction.rejected, (s, a) => { s.runStatus = 'failed'; s.runError = a.payload; })

      .addCase(fetchTopologyIssues.pending, (s) => { if (s.issuesStatus === 'idle') s.issuesStatus = 'loading'; })
      .addCase(fetchTopologyIssues.fulfilled, (s, a) => { s.issuesStatus = 'succeeded'; s.issues = a.payload; })
      .addCase(fetchTopologyIssues.rejected, (s) => { s.issuesStatus = 'failed'; })
      .addCase(runTopology.pending, (s) => { s.topoRunStatus = 'loading'; s.topoError = null; })
      .addCase(runTopology.fulfilled, (s) => { s.topoRunStatus = 'succeeded'; })
      .addCase(runTopology.rejected, (s, a) => { s.topoRunStatus = 'failed'; s.topoError = a.payload; })
      .addCase(resolveIssue.pending, (s) => { s.resolveError = null; })
      .addCase(resolveIssue.fulfilled, (s, a) => {
        const i = s.issues.find((x) => x.id === a.payload.id);
        if (i) i.status = a.payload.status;
      })
      .addCase(resolveIssue.rejected, (s, a) => { s.resolveError = a.payload; })

      .addCase(fetchCrsList.fulfilled, (s, a) => { s.crsList = a.payload; })
      .addCase(transformCoordinates.pending, (s) => { s.transformStatus = 'loading'; s.transformError = null; })
      .addCase(transformCoordinates.fulfilled, (s, a) => { s.transformStatus = 'succeeded'; s.transformed = a.payload; })
      .addCase(transformCoordinates.rejected, (s, a) => { s.transformStatus = 'failed'; s.transformError = a.payload; })
      .addCase(previewGeoref.pending, (s) => { s.georefStatus = 'loading'; })
      .addCase(previewGeoref.fulfilled, (s, a) => { s.georefStatus = 'succeeded'; s.georefPreview = a.payload; s.georefError = null; })
      .addCase(previewGeoref.rejected, (s, a) => { s.georefStatus = 'failed'; s.georefError = a.payload; })
      .addCase(applyGeoref.pending, (s) => { s.applyStatus = 'loading'; s.georefError = null; })
      .addCase(applyGeoref.fulfilled, (s) => { s.applyStatus = 'succeeded'; })
      .addCase(applyGeoref.rejected, (s, a) => { s.applyStatus = 'failed'; s.georefError = a.payload; });
  },
});

export const { resetGeoref, resetRun } = slice.actions;

export const selectRuns = (s) => s.processing.runs;
export const selectRunsStatus = (s) => s.processing.runsStatus;
export const selectExtractStatus = (s) => s.processing.runStatus;
export const selectExtractError = (s) => s.processing.runError;
export const selectIssues = (s) => s.processing.issues;
export const selectIssuesStatus = (s) => s.processing.issuesStatus;
export const selectTopoRunStatus = (s) => s.processing.topoRunStatus;
export const selectTopoError = (s) => s.processing.topoError;
export const selectResolveIssueError = (s) => s.processing.resolveError;
export const selectCrsList = (s) => s.processing.crsList;
export const selectTransformed = (s) => s.processing.transformed;
export const selectTransformStatus = (s) => s.processing.transformStatus;
export const selectTransformError = (s) => s.processing.transformError;
export const selectGeorefPreview = (s) => s.processing.georefPreview;
export const selectGeorefStatus = (s) => s.processing.georefStatus;
export const selectGeorefError = (s) => s.processing.georefError;
export const selectApplyStatus = (s) => s.processing.applyStatus;

export default slice.reducer;
