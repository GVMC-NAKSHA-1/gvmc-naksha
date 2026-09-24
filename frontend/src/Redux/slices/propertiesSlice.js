import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { agentApi, asList, cleanParams, errorMessage } from '../../api/client';

const num = (v, d = 0) => (v == null || Number.isNaN(Number(v)) ? d : Number(v));

export const mapAPIToUI = (p) => {
  const breakdown = p.confidence_breakdown ?? {};
  return {
    id: String(p.id),
    wardId: p.ward_id != null ? String(p.ward_id) : null,
    wardName: p.ward_name ?? null,
    lat: num(p.lat),
    lng: num(p.lng),
    areaSqm: p.area_sqm != null ? num(p.area_sqm) : null,
    detectionType: p.detection_type,
    confidence: num(p.confidence),
    ndbiDelta: num(p.ndbi_delta ?? breakdown.ndbi_delta, 0),
    confidenceBreakdown: breakdown,
    detectedAt: p.detected_at ?? null,
    s3GeojsonKey: p.s3_geojson_key ?? p.geojson_r2 ?? null,
    status: p.status ?? 'pending',
    comparisonYear: p.comparison_year ?? null,
    baselineYear: p.baseline_year ?? null,
    aiExplanation: p.ai_explanation ?? null,
  };
};

export const fetchProperties = createAsyncThunk(
  'properties/fetchProperties',
  async ({ wardId, type, status, compareYear } = {}, { rejectWithValue }) => {
    try {
      const { data } = await api.get(`/api/wards/${wardId}/unassessed`, {
        params: cleanParams({ type, status, comparison_year: compareYear }),
      });
      return asList(data, 'properties').map(mapAPIToUI);
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
);

export const fetchPropertyById = createAsyncThunk('properties/fetchPropertyById', async (id, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/api/properties/${id}`);
    return mapAPIToUI(data?.property ?? data);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchPropertyExplanation = createAsyncThunk(
  'properties/fetchPropertyExplanation',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await agentApi.get(`/api/properties/${id}/explain`);
      return { id: String(id), aiExplanation: data?.ai_explanation ?? '' };
    } catch (err) {
      return rejectWithValue(err.response?.data?.detail ?? errorMessage(err));
    }
  },
);

export const verifyProperty = createAsyncThunk(
  'properties/verifyProperty',
  async ({ id, status, notes, updatedBy = 'officer' }, { rejectWithValue }) => {
    try {
      await api.post(`/api/properties/${id}/verify`, cleanParams({ status, notes, updatedBy }));
      return { id: String(id), status };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
);

const initialState = {
  items: [],
  selectedItem: null,
  status: 'idle',
  fetchOneStatus: 'idle',
  explanationStatus: 'idle',
  explanationError: null,
  error: null,
  verifyStatus: 'idle',
  verifyError: null,
};

const patchItem = (state, id, patch) => {
  const it = state.items.find((p) => p.id === id);
  if (it) Object.assign(it, patch);
  if (state.selectedItem?.id === id) Object.assign(state.selectedItem, patch);
};

const propertiesSlice = createSlice({
  name: 'properties',
  initialState,
  reducers: {
    setSelectedProperty(state, action) {
      const id = action.payload == null ? null : String(action.payload);
      state.selectedItem = id ? state.items.find((p) => p.id === id) ?? null : null;
      state.fetchOneStatus = 'idle';
      state.explanationStatus = 'idle';
      state.explanationError = null;
      state.verifyStatus = 'idle';
      state.verifyError = null;
    },
    clearSelectedProperty(state) { state.selectedItem = null; },
    resetVerifyStatus(state) { state.verifyStatus = 'idle'; state.verifyError = null; },
    clearErrors(state) { state.error = null; state.verifyError = null; state.explanationError = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchProperties.pending, (s) => { s.status = 'loading'; s.error = null; })
      .addCase(fetchProperties.fulfilled, (s, a) => {
        s.status = 'succeeded';
        s.items = a.payload;
        if (s.selectedItem) s.selectedItem = a.payload.find((p) => p.id === s.selectedItem.id) ?? null;
      })
      .addCase(fetchProperties.rejected, (s, a) => { s.status = 'failed'; s.error = a.payload; s.items = []; })

      .addCase(fetchPropertyById.pending, (s) => { s.fetchOneStatus = 'loading'; })
      .addCase(fetchPropertyById.fulfilled, (s, a) => {
        s.fetchOneStatus = 'succeeded';
        if (s.selectedItem?.id === a.payload.id) {
          // keep an explanation that may already have arrived
          const aiExplanation = s.selectedItem.aiExplanation || a.payload.aiExplanation;
          s.selectedItem = { ...s.selectedItem, ...a.payload, aiExplanation };
        }
      })
      .addCase(fetchPropertyById.rejected, (s) => { s.fetchOneStatus = 'failed'; })

      .addCase(fetchPropertyExplanation.pending, (s) => { s.explanationStatus = 'loading'; s.explanationError = null; })
      .addCase(fetchPropertyExplanation.fulfilled, (s, a) => {
        s.explanationStatus = 'succeeded';
        patchItem(s, a.payload.id, { aiExplanation: a.payload.aiExplanation });
      })
      .addCase(fetchPropertyExplanation.rejected, (s, a) => { s.explanationStatus = 'failed'; s.explanationError = a.payload; })

      .addCase(verifyProperty.pending, (s) => { s.verifyStatus = 'loading'; s.verifyError = null; })
      .addCase(verifyProperty.fulfilled, (s, a) => {
        s.verifyStatus = 'succeeded';
        patchItem(s, a.payload.id, { status: a.payload.status });
      })
      .addCase(verifyProperty.rejected, (s, a) => { s.verifyStatus = 'failed'; s.verifyError = a.payload; });
  },
});

export const { setSelectedProperty, clearSelectedProperty, resetVerifyStatus, clearErrors } = propertiesSlice.actions;

export const selectProperties = (s) => s.properties.items;
export const selectSelectedProperty = (s) => s.properties.selectedItem;
export const selectPropertiesStatus = (s) => s.properties.status;
export const selectPropertiesError = (s) => s.properties.error;
export const selectExplanationStatus = (s) => s.properties.explanationStatus;
export const selectExplanationError = (s) => s.properties.explanationError;
export const selectVerifyStatus = (s) => s.properties.verifyStatus;
export const selectVerifyError = (s) => s.properties.verifyError;

export default propertiesSlice.reducer;
