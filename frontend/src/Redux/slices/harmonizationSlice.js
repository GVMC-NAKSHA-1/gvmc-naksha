import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { asList, cleanParams, errorMessage } from '../../api/client';

/** Backend stores only match_score; derive the band the same way the worker does when absent. */
export const bandFor = (score) => (score >= 85 ? 'auto_accept' : score >= 60 ? 'review' : 'conflict');

export const mapAPIToUI = (m) => {
  const matchScore = Number(m.match_score ?? 0);
  return {
    id: String(m.id),
    wardId: m.ward_id != null ? String(m.ward_id) : null,
    sourceAId: m.source_a_id ?? m.feature_a_id ?? null,
    sourceAType: m.source_a_type,
    sourceBId: m.source_b_id ?? m.feature_b_id ?? null,
    sourceBType: m.source_b_type,
    geometryIou: m.geometry_iou != null ? Number(m.geometry_iou) : null,
    centroidDistanceM: m.centroid_distance_m != null ? Number(m.centroid_distance_m) : null,
    matchScore,
    confidenceScore: Number(m.confidence_score ?? matchScore),
    band: m.band ?? bandFor(matchScore),
    matchedAt: m.matched_at ?? null,
  };
};

/** Backend queues one HARMONIZE_WARD job per ward and answers 202 `{ status, jobs }`. */
export const runMatching = createAsyncThunk('harmonization/runMatching', async (wardId, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/api/harmonization/run', {}, { params: cleanParams({ wardId }) });
    return data ?? {};
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchMatches = createAsyncThunk('harmonization/fetchMatches', async ({ wardId, minScore } = {}, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/harmonization/matches', { params: cleanParams({ wardId, minScore }) });
    return asList(data, 'matches').map(mapAPIToUI);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

const harmonizationSlice = createSlice({
  name: 'harmonization',
  initialState: {
    matches: [],
    matchesStatus: 'idle',
    matchesError: null,
    runStatus: 'idle',
    runError: null,
    lastRunResult: null,
  },
  reducers: {
    resetRunStatus(state) { state.runStatus = 'idle'; state.runError = null; },
    clearErrors(state) { state.matchesError = null; state.runError = null; },
  },
  extraReducers: (b) => {
    b.addCase(runMatching.pending, (s) => { s.runStatus = 'loading'; s.runError = null; })
      .addCase(runMatching.fulfilled, (s, a) => { s.runStatus = 'succeeded'; s.lastRunResult = a.payload; })
      .addCase(runMatching.rejected, (s, a) => { s.runStatus = 'failed'; s.runError = a.payload; })
      .addCase(fetchMatches.pending, (s) => { s.matchesStatus = 'loading'; s.matchesError = null; })
      .addCase(fetchMatches.fulfilled, (s, a) => { s.matchesStatus = 'succeeded'; s.matches = a.payload; })
      .addCase(fetchMatches.rejected, (s, a) => { s.matchesStatus = 'failed'; s.matchesError = a.payload; });
  },
});

export const { resetRunStatus, clearErrors } = harmonizationSlice.actions;

export const selectMatches = (s) => s.harmonization.matches;
export const selectMatchesStatus = (s) => s.harmonization.matchesStatus;
export const selectMatchesError = (s) => s.harmonization.matchesError;
export const selectRunStatus = (s) => s.harmonization.runStatus;
export const selectRunError = (s) => s.harmonization.runError;
export const selectLastRunResult = (s) => s.harmonization.lastRunResult;

export default harmonizationSlice.reducer;
