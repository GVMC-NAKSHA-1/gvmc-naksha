import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { asList, cleanParams, errorMessage } from '../../api/client';

// Golden records: one harmonized parcel per cluster of matched features (worker assemble.py).

export const mapAPIToUI = (h) => ({
  id: String(h.id),
  wardId: h.ward_id != null ? String(h.ward_id) : null,
  geomSourceType: h.geom_source_type ?? null,
  attributes: h.attributes ?? {},
  provenance: h.attribute_provenance ?? {},
  confidence: h.confidence != null ? Number(h.confidence) : null, // 0–1
  conflictCount: Number(h.conflict_count ?? 0),
  memberCount: Number(h.member_count ?? h.member_feature_ids?.length ?? 0),
  memberFeatureIds: h.member_feature_ids ?? [],
  matchIds: h.match_ids ?? [],
  assembledAt: h.assembled_at ?? null,
  geometry: h.geometry ?? null,
});

export const mapExport = (e) => ({
  id: String(e.id),
  format: e.format,
  status: e.status,
  featureCount: e.feature_count ?? null,
  error: e.error ?? null,
  createdAt: e.created_at ?? null,
  downloadUrl: e.download_url ?? null,
});

export const fetchHarmonized = createAsyncThunk('harmonized/fetchHarmonized', async ({ wardId, minConfidence } = {}, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/harmonized', { params: cleanParams({ wardId, minConfidence }) });
    return asList(data, 'parcels').map(mapAPIToUI);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchHarmonizedDetail = createAsyncThunk('harmonized/fetchHarmonizedDetail', async (id, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/api/harmonized/${id}`);
    return mapAPIToUI(data);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const assembleWard = createAsyncThunk('harmonized/assembleWard', async (wardId, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/api/harmonized/assemble', {}, { params: cleanParams({ wardId }) });
    return data ?? {};
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/**
 * Golden-record geometry for the map. The backend returns the FeatureCollection inline when no
 * object storage is configured, otherwise a presigned URL to it.
 */
export const fetchHarmonizedGeoJSON = createAsyncThunk('harmonized/fetchHarmonizedGeoJSON', async (wardId, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/harmonized/export', { params: { wardId, format: 'geojson' } });
    if (data?.type === 'FeatureCollection') return data;
    if (data?.geojson) return data.geojson;
    if (data?.presigned_url) return await (await fetch(data.presigned_url)).json();
    return { type: 'FeatureCollection', features: [] };
  } catch (err) {
    // 400 = nothing assembled yet; show an empty layer rather than an error.
    if (err?.response?.status === 400) return { type: 'FeatureCollection', features: [] };
    return rejectWithValue(errorMessage(err));
  }
});

/** GeoJSON is built synchronously; GeoPackage is queued and appears in the exports list. */
export const exportHarmonized = createAsyncThunk('harmonized/exportHarmonized', async ({ wardId, format }, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/harmonized/export', { params: { wardId, format } });
    return { format, ...data };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchExports = createAsyncThunk('harmonized/fetchExports', async (wardId, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/harmonized/exports', { params: { wardId } });
    return asList(data, 'exports').map(mapExport);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

const harmonizedSlice = createSlice({
  name: 'harmonized',
  initialState: {
    items: [],
    status: 'idle',
    error: null,
    detail: null,
    detailStatus: 'idle',
    assembleStatus: 'idle',
    assembleError: null,
    geojson: null,
    geojsonStatus: 'idle',
    exports: [],
    exportsStatus: 'idle',
    exportStatus: 'idle',
    exportError: null,
  },
  reducers: {
    clearDetail(state) { state.detail = null; state.detailStatus = 'idle'; },
    resetAssembleStatus(state) { state.assembleStatus = 'idle'; state.assembleError = null; },
    resetExportStatus(state) { state.exportStatus = 'idle'; state.exportError = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchHarmonized.pending, (s) => { s.status = 'loading'; s.error = null; })
      .addCase(fetchHarmonized.fulfilled, (s, a) => { s.status = 'succeeded'; s.items = a.payload; })
      .addCase(fetchHarmonized.rejected, (s, a) => { s.status = 'failed'; s.error = a.payload; })

      .addCase(fetchHarmonizedDetail.pending, (s) => { s.detailStatus = 'loading'; })
      .addCase(fetchHarmonizedDetail.fulfilled, (s, a) => { s.detailStatus = 'succeeded'; s.detail = a.payload; })
      .addCase(fetchHarmonizedDetail.rejected, (s) => { s.detailStatus = 'failed'; })

      .addCase(assembleWard.pending, (s) => { s.assembleStatus = 'loading'; s.assembleError = null; })
      .addCase(assembleWard.fulfilled, (s) => { s.assembleStatus = 'succeeded'; })
      .addCase(assembleWard.rejected, (s, a) => { s.assembleStatus = 'failed'; s.assembleError = a.payload; })

      .addCase(fetchHarmonizedGeoJSON.pending, (s) => { s.geojsonStatus = 'loading'; })
      .addCase(fetchHarmonizedGeoJSON.fulfilled, (s, a) => { s.geojsonStatus = 'succeeded'; s.geojson = a.payload; })
      .addCase(fetchHarmonizedGeoJSON.rejected, (s) => { s.geojsonStatus = 'failed'; s.geojson = null; })

      .addCase(exportHarmonized.pending, (s) => { s.exportStatus = 'loading'; s.exportError = null; })
      .addCase(exportHarmonized.fulfilled, (s) => { s.exportStatus = 'succeeded'; })
      .addCase(exportHarmonized.rejected, (s, a) => { s.exportStatus = 'failed'; s.exportError = a.payload; })

      .addCase(fetchExports.pending, (s) => { s.exportsStatus = 'loading'; })
      .addCase(fetchExports.fulfilled, (s, a) => { s.exportsStatus = 'succeeded'; s.exports = a.payload; })
      .addCase(fetchExports.rejected, (s) => { s.exportsStatus = 'failed'; });
  },
});

export const { clearDetail, resetAssembleStatus, resetExportStatus } = harmonizedSlice.actions;

export const selectHarmonized = (s) => s.harmonized.items;
export const selectHarmonizedStatus = (s) => s.harmonized.status;
export const selectHarmonizedError = (s) => s.harmonized.error;
export const selectHarmonizedDetail = (s) => s.harmonized.detail;
export const selectHarmonizedDetailStatus = (s) => s.harmonized.detailStatus;
export const selectAssembleStatus = (s) => s.harmonized.assembleStatus;
export const selectAssembleError = (s) => s.harmonized.assembleError;
export const selectHarmonizedGeoJSON = (s) => s.harmonized.geojson;
export const selectExports = (s) => s.harmonized.exports;
export const selectExportStatus = (s) => s.harmonized.exportStatus;
export const selectExportError = (s) => s.harmonized.exportError;

export default harmonizedSlice.reducer;
