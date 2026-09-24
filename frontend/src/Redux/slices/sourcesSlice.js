import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { asList, cleanParams, errorMessage } from '../../api/client';

export const SOURCE_TYPES = [
  'cadastral', 'revenue', 'municipal_gis', 'utility', 'drone_imagery',
  'ori', 'dsm_dtm', 'ground_truth', 'gnss_cors', 'building_footprint',
];

// Must match the ContentType the backend signs the PUT URL with (sources.service.ts EXT/CT maps).
const EXT = {
  drone_imagery: 'tif', ori: 'tif', dsm_dtm: 'tif',
  cadastral: 'geojson', municipal_gis: 'geojson', utility: 'geojson', building_footprint: 'geojson',
  revenue: 'csv', ground_truth: 'gpx', gnss_cors: 'csv',
};
const CT = {
  tif: 'image/tiff', geojson: 'application/geo+json', csv: 'text/csv', gpx: 'application/gpx+xml', pdf: 'application/pdf',
};

export const mapAPIToUI = (s) => ({
  id: String(s.id),
  type: s.type,
  wardId: s.ward_id != null ? String(s.ward_id) : null,
  s3Key: s.s3_key ?? s.r2_key ?? null,
  filename: s.filename ?? s.original_name ?? null,
  crs: s.crs ?? null,
  status: s.status ?? 'processing',
  capturedAt: s.captured_at ?? null,
  createdAt: s.created_at ?? null,
  metadata: s.metadata ?? {},
  downloadUrl: s.download_url ?? null,
});

export const fetchSources = createAsyncThunk('sources/fetchSources', async ({ type, wardId, status } = {}, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/sources', { params: cleanParams({ type, wardId, status }) });
    return asList(data, 'sources').map(mapAPIToUI);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/**
 * Two-step upload: register the source (backend returns a presigned PUT URL), then PUT the raw file.
 * Scanned revenue records (PDF) go through the OCR path.
 */
export const uploadSource = createAsyncThunk(
  'sources/uploadSource',
  async ({ file, type, wardId, crs, capturedAt }, { rejectWithValue }) => {
    try {
      const scanned = type === 'revenue' && /\.pdf$/i.test(file.name);
      const { data } = await api.post('/api/sources/upload', cleanParams({
        type, wardId: wardId ? String(wardId) : undefined, originalName: file.name, crs, capturedAt,
        scanned: scanned || undefined,
      }));
      const uploadUrl = data?.uploadUrl ?? data?.upload_url;
      if (uploadUrl) {
        const res = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': CT[scanned ? 'pdf' : EXT[type]] ?? file.type ?? 'application/octet-stream' },
        });
        if (!res.ok) throw new Error(`File upload failed (${res.status})`);
      }
      return { id: data?.sourceId ?? data?.id, status: data?.status };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
);

const sourcesSlice = createSlice({
  name: 'sources',
  initialState: { items: [], status: 'idle', error: null, uploadStatus: 'idle', uploadError: null },
  reducers: {
    resetUploadStatus(state) { state.uploadStatus = 'idle'; state.uploadError = null; },
    clearErrors(state) { state.error = null; state.uploadError = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchSources.pending, (s) => { s.status = 'loading'; s.error = null; })
      .addCase(fetchSources.fulfilled, (s, a) => { s.status = 'succeeded'; s.items = a.payload; })
      .addCase(fetchSources.rejected, (s, a) => { s.status = 'failed'; s.error = a.payload; })
      .addCase(uploadSource.pending, (s) => { s.uploadStatus = 'loading'; s.uploadError = null; })
      .addCase(uploadSource.fulfilled, (s) => { s.uploadStatus = 'succeeded'; })
      .addCase(uploadSource.rejected, (s, a) => { s.uploadStatus = 'failed'; s.uploadError = a.payload; });
  },
});

export const { resetUploadStatus, clearErrors } = sourcesSlice.actions;

export const selectSources = (s) => s.sources.items;
export const selectSourcesStatus = (s) => s.sources.status;
export const selectSourcesError = (s) => s.sources.error;
export const selectSourceUploadStatus = (s) => s.sources.uploadStatus;
export const selectSourceUploadError = (s) => s.sources.uploadError;

export default sourcesSlice.reducer;
