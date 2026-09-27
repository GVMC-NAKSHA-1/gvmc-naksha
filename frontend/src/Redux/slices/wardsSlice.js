import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { asList, errorMessage } from '../../api/client';

export const mapAPIToUI = (w) => ({
  id: String(w.id),
  name: w.name,
  bbox: w.bbox ?? {
    north: Number(w.bbox_north) || 0, south: Number(w.bbox_south) || 0,
    east: Number(w.bbox_east) || 0, west: Number(w.bbox_west) || 0,
  },
  geojsonS3: w.geojson_s3 ?? w.geojson_r2 ?? null,
  detectionCount: Number(w.detection_count ?? 0),
});

export const fetchWards = createAsyncThunk('wards/fetchWards', async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/wards');
    return asList(data, 'wards').map(mapAPIToUI);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** Source features for a ward as a FeatureCollection (backend: GET /api/wards/:id/geojson). */
export const fetchWardGeoJSON = createAsyncThunk('wards/fetchWardGeoJSON', async (wardId, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/api/wards/${wardId}/geojson`);
    if (data?.presigned_url) {
      const res = await fetch(data.presigned_url);
      return await res.json();
    }
    return data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** Survey of India villages touching a ward (backend: GET /api/wards/:id/villages). */
export const fetchWardVillages = createAsyncThunk('wards/fetchWardVillages', async (wardId) => {
  try {
    const { data } = await api.get(`/api/wards/${wardId}/villages`);
    return data?.type === 'FeatureCollection' ? data : { type: 'FeatureCollection', features: [] };
  } catch {
    // Optional reference layer: an API without it (or no villages loaded) just shows nothing.
    return { type: 'FeatureCollection', features: [] };
  }
});

/** Every Survey of India village, for the "show all" overview (backend: GET /api/villages). */
export const fetchAllVillages = createAsyncThunk('wards/fetchAllVillages', async () => {
  try {
    const { data } = await api.get('/api/villages');
    return data?.type === 'FeatureCollection' ? data : { type: 'FeatureCollection', features: [] };
  } catch {
    return { type: 'FeatureCollection', features: [] };
  }
});

const initialState = {
  items: [],
  selectedWardId: null,
  wardGeoJSON: null,
  villages: null,
  allVillages: null,
  status: 'idle',
  geoJSONStatus: 'idle',
  error: null,
};

const wardsSlice = createSlice({
  name: 'wards',
  initialState,
  reducers: {
    setSelectedWard(state, action) {
      state.selectedWardId = action.payload || null;
      state.wardGeoJSON = null;
      state.geoJSONStatus = 'idle';
      state.villages = null;
    },
    clearErrors(state) { state.error = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchWards.pending, (s) => { s.status = 'loading'; s.error = null; })
      .addCase(fetchWards.fulfilled, (s, a) => { s.status = 'succeeded'; s.items = a.payload; })
      .addCase(fetchWards.rejected, (s, a) => { s.status = 'failed'; s.error = a.payload; })
      .addCase(fetchWardGeoJSON.pending, (s) => { s.geoJSONStatus = 'loading'; })
      .addCase(fetchWardGeoJSON.fulfilled, (s, a) => { s.geoJSONStatus = 'succeeded'; s.wardGeoJSON = a.payload; })
      .addCase(fetchWardGeoJSON.rejected, (s, a) => { s.geoJSONStatus = 'failed'; s.error = a.payload; })
      .addCase(fetchAllVillages.fulfilled, (s, a) => { s.allVillages = a.payload; })
      .addCase(fetchWardVillages.fulfilled, (s, a) => { if (a.meta.arg === s.selectedWardId) s.villages = a.payload; });
  },
});

export const { setSelectedWard, clearErrors } = wardsSlice.actions;

export const selectWards = (s) => s.wards.items;
export const selectSelectedWardId = (s) => s.wards.selectedWardId;
export const selectSelectedWard = (s) => s.wards.items.find((w) => w.id === s.wards.selectedWardId) ?? null;
export const selectWardGeoJSON = (s) => s.wards.wardGeoJSON;
export const selectWardVillages = (s) => s.wards.villages;
export const selectAllVillages = (s) => s.wards.allVillages;
export const selectWardsStatus = (s) => s.wards.status;
export const selectGeoJSONStatus = (s) => s.wards.geoJSONStatus;
export const selectWardsError = (s) => s.wards.error;

export default wardsSlice.reducer;
