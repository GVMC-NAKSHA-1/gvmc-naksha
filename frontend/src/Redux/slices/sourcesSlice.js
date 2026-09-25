import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { asList, cleanParams, errorMessage } from '../../api/client';

// Must match the ContentType the backend signs the PUT URL with (backend sources.service.ts EXT/CT).
const EXT = {
  drone_imagery: 'tif', ori: 'tif', dsm_dtm: 'tif',
  cadastral: 'geojson', municipal_gis: 'geojson', utility: 'geojson', building_footprint: 'geojson',
  revenue: 'csv', ground_truth: 'gpx', gnss_cors: 'csv',
};
const CT = {
  tif: 'image/tiff', tiff: 'image/tiff', geojson: 'application/geo+json', json: 'application/geo+json', csv: 'text/csv',
  gpx: 'application/gpx+xml', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};
const extOf = (name) => String(name ?? '').split('.').pop().toLowerCase();

export const mapAPIToUI = (s) => {
  const metadata = s.metadata ?? {};
  return {
    id: String(s.id),
    type: s.type,
    wardId: s.ward_id != null ? String(s.ward_id) : null,
    s3Key: s.s3_key ?? s.r2_key ?? null,
    filename: s.filename ?? s.original_name ?? null,
    crs: s.crs ?? null,
    status: s.status ?? 'processing',
    scanned: Boolean(s.scanned),
    capturedAt: s.captured_at ?? null,
    createdAt: s.created_at ?? null,
    error: s.error ?? metadata.error ?? null,
    metadata,
    featureCount: metadata.feature_count ?? null,
    fields: Array.isArray(metadata.fields) ? metadata.fields : [],
    ocr: metadata.ocr ?? null,
    ocrConfidence: metadata.ocr_confidence ?? null,
    downloadUrl: s.download_url ?? null,
    previewUrl: s.preview_url ?? null,
    georef: metadata.georef ?? null,
    imageSize: metadata.image_width ? { width: metadata.image_width, height: metadata.image_height } : null,
    parentSourceId: metadata.parent_source_id ?? null,
    // Open-data pack layers are generated test data (data/README.md); say so wherever they appear.
    synthetic: metadata.synthetic === true,
    description: metadata.description ?? null,
    method: metadata.method ?? null,
  };
};

export const fetchSources = createAsyncThunk('sources/fetchSources', async ({ type, wardId, status } = {}, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/sources', { params: cleanParams({ type, wardId, status }) });
    return asList(data, 'sources').map(mapAPIToUI);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchSourceDetail = createAsyncThunk('sources/fetchSourceDetail', async (id, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/api/sources/${id}`);
    return mapAPIToUI(data);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** Normalised (WGS84, topology-fixed) features of one source, as a FeatureCollection. */
export const fetchSourceFeatures = createAsyncThunk('sources/fetchSourceFeatures', async (id, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/api/sources/${id}/features`);
    return { id: String(id), fc: data?.type === 'FeatureCollection' ? data : { type: 'FeatureCollection', features: [] } };
  } catch (err) {
    return rejectWithValue({ id: String(id), error: errorMessage(err) });
  }
}, {
  condition: (id, { getState }) => {
    const st = getState().sources.features[String(id)]?.status;
    return st !== 'loading' && st !== 'succeeded';
  },
});

/** Queue OCR for a scanned record (revenue PDF). */
export const digitizeSource = createAsyncThunk('sources/digitizeSource', async (id, { rejectWithValue }) => {
  try {
    await api.post(`/api/sources/${id}/digitize`);
    return { id: String(id) };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/**
 * Two-step upload: register the source (backend returns a presigned PUT URL), then PUT the raw
 * file. The worker then reprojects to WGS84, repairs invalid geometry and extracts fields.
 */
export const uploadSource = createAsyncThunk(
  'sources/uploadSource',
  async ({ file, type, wardId, crs, capturedAt }, { rejectWithValue }) => {
    try {
      const scanned = type === 'revenue' && /\.pdf$/i.test(file.name);
      const { data } = await api.post('/api/sources/upload', cleanParams({
        type,
        wardId: wardId ? String(wardId) : undefined,
        originalName: file.name,
        crs: crs || undefined,
        capturedAt: capturedAt ? new Date(capturedAt).toISOString() : undefined,
        scanned: scanned || undefined,
      }));
      const id = data?.sourceId ?? data?.id;
      const uploadUrl = data?.uploadUrl ?? data?.upload_url;
      if (uploadUrl) {
        // Must match the Content-Type the URL was signed with (returned by the API).
        const contentType = data?.contentType ?? CT[extOf(file.name)] ?? CT[scanned ? 'pdf' : EXT[type]] ?? 'application/octet-stream';
        const res = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': contentType } });
        if (!res.ok) throw new Error(`File upload failed (${res.status})`);
      }
      // Start ETL only once the object exists in storage.
      const done = await api.post(`/api/sources/${id}/complete`).catch(() => null);
      return { id, status: done?.data?.status ?? data?.status, jobId: done?.data?.jobId ?? null };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
);

const sourcesSlice = createSlice({
  name: 'sources',
  initialState: {
    items: [],
    status: 'idle',
    error: null,
    uploadStatus: 'idle',
    uploadError: null,
    detail: null,
    detailStatus: 'idle',
    digitizeStatus: 'idle',
    digitizeError: null,
    features: {}, // sourceId -> { status, fc, error }
  },
  reducers: {
    resetUploadStatus(state) { state.uploadStatus = 'idle'; state.uploadError = null; },
    clearDetail(state) { state.detail = null; state.detailStatus = 'idle'; state.digitizeStatus = 'idle'; state.digitizeError = null; },
    invalidateFeatures(state) { state.features = {}; },
    clearErrors(state) { state.error = null; state.uploadError = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchSources.pending, (s) => { s.status = 'loading'; s.error = null; })
      .addCase(fetchSources.fulfilled, (s, a) => { s.status = 'succeeded'; s.items = a.payload; })
      .addCase(fetchSources.rejected, (s, a) => { s.status = 'failed'; s.error = a.payload; })

      .addCase(fetchSourceDetail.pending, (s) => { s.detailStatus = 'loading'; })
      .addCase(fetchSourceDetail.fulfilled, (s, a) => { s.detailStatus = 'succeeded'; s.detail = a.payload; })
      .addCase(fetchSourceDetail.rejected, (s) => { s.detailStatus = 'failed'; })

      .addCase(fetchSourceFeatures.pending, (s, a) => { s.features[String(a.meta.arg)] = { status: 'loading', fc: null, error: null }; })
      .addCase(fetchSourceFeatures.fulfilled, (s, a) => { s.features[a.payload.id] = { status: 'succeeded', fc: a.payload.fc, error: null }; })
      .addCase(fetchSourceFeatures.rejected, (s, a) => {
        const id = String(a.meta.arg);
        s.features[id] = { status: 'failed', fc: null, error: a.payload?.error ?? a.error.message };
      })

      .addCase(digitizeSource.pending, (s) => { s.digitizeStatus = 'loading'; s.digitizeError = null; })
      .addCase(digitizeSource.fulfilled, (s, a) => {
        s.digitizeStatus = 'succeeded';
        const it = s.items.find((x) => x.id === a.payload.id);
        if (it) it.status = 'processing';
        if (s.detail?.id === a.payload.id) s.detail.status = 'processing';
      })
      .addCase(digitizeSource.rejected, (s, a) => { s.digitizeStatus = 'failed'; s.digitizeError = a.payload; })

      .addCase(uploadSource.pending, (s) => { s.uploadStatus = 'loading'; s.uploadError = null; })
      .addCase(uploadSource.fulfilled, (s) => { s.uploadStatus = 'succeeded'; })
      .addCase(uploadSource.rejected, (s, a) => { s.uploadStatus = 'failed'; s.uploadError = a.payload; });
  },
});

export const { resetUploadStatus, clearDetail, invalidateFeatures, clearErrors } = sourcesSlice.actions;

export const selectSources = (s) => s.sources.items;
export const selectSourcesStatus = (s) => s.sources.status;
export const selectSourcesError = (s) => s.sources.error;
export const selectSourceUploadStatus = (s) => s.sources.uploadStatus;
export const selectSourceUploadError = (s) => s.sources.uploadError;
export const selectSourceDetail = (s) => s.sources.detail;
export const selectSourceDetailStatus = (s) => s.sources.detailStatus;
export const selectDigitizeStatus = (s) => s.sources.digitizeStatus;
export const selectDigitizeError = (s) => s.sources.digitizeError;
export const selectSourceFeatures = (s) => s.sources.features;

export default sourcesSlice.reducer;
