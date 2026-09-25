import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { asList, cleanParams, errorMessage } from '../../api/client';
import { CONFIDENCE_WEIGHTS } from '../../utils/format';

/**
 * Band by geometric match score (auto-accept ≥ 85, review ≥ 60, else conflict) — the same signal the
 * worker's conflict rules use. The weighted confidence can't reach 85 while the backend still fixes
 * the attribute (0.5) and recency (1.0) terms, so it is shown alongside but not used for banding.
 */
export const bandFor = (score) => (score >= 85 ? 'auto_accept' : score >= 60 ? 'review' : 'conflict');

/** Recomputes the worker's weighted confidence (match.py) from the stored breakdown. */
export function confidenceFromBreakdown(breakdown, fallback) {
  const keys = Object.keys(CONFIDENCE_WEIGHTS);
  if (!breakdown || !keys.some((k) => breakdown[k] != null)) return fallback;
  return Math.round(100 * keys.reduce((sum, k) => sum + CONFIDENCE_WEIGHTS[k].weight * Number(breakdown[k] ?? 0), 0));
}

export const mapAPIToUI = (m) => {
  const matchScore = Number(m.match_score ?? 0);
  const breakdown = m.confidence_breakdown ?? {};
  const confidenceScore = m.confidence_score != null ? Number(m.confidence_score) : confidenceFromBreakdown(breakdown, matchScore);
  return {
    id: String(m.id),
    wardId: m.ward_id != null ? String(m.ward_id) : null,
    featureAId: m.feature_a_id ?? m.source_a_id ?? null,
    featureBId: m.feature_b_id ?? m.source_b_id ?? null,
    sourceAType: m.source_a_type,
    sourceBType: m.source_b_type,
    geometryIou: m.geometry_iou != null ? Number(m.geometry_iou) : null,
    centroidDistanceM: m.centroid_distance_m != null ? Number(m.centroid_distance_m) : null,
    matchScore,
    confidenceScore,
    confidenceBreakdown: breakdown,
    band: m.band ?? bandFor(matchScore),
    matchedAt: m.matched_at ?? null,
  };
};

export const mapMatchDetail = (d) => ({
  ...mapAPIToUI(d),
  featureAGeom: d.feature_a_geom ?? null,
  featureAProps: d.feature_a_props ?? {},
  featureBGeom: d.feature_b_geom ?? null,
  featureBProps: d.feature_b_props ?? {},
});

export const mapMapping = (m) => ({
  id: String(m.id ?? `${m.field_a}->${m.field_b}`),
  sourceAId: m.source_a_id ?? null,
  sourceBId: m.source_b_id ?? null,
  fieldA: m.field_a,
  fieldB: m.field_b,
  confidence: m.confidence != null ? Number(m.confidence) : null,
  rationale: m.rationale ?? '',
  approved: m.approved ?? null,
});

/** Queues HARMONIZE_WARD (match → conflicts → assemble) per ward. Backend answers 202. */
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

export const fetchMatchDetail = createAsyncThunk('harmonization/fetchMatchDetail', async (id, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/api/harmonization/matches/${id}`);
    return mapMatchDetail(data);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchMappings = createAsyncThunk('harmonization/fetchMappings', async ({ sourceAId, sourceBId } = {}, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/harmonization/schema-map', { params: cleanParams({ sourceAId, sourceBId }) });
    return asList(data, 'mappings').map(mapMapping);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/**
 * AI attribute mapping: sends both schemas (+ sample rows) to the LLM-backed endpoint.
 * Passing both source ids persists the result so golden-record assembly uses it.
 */
export const suggestMappings = createAsyncThunk(
  'harmonization/suggestMappings',
  async ({ a, b, sourceAId, sourceBId }, { rejectWithValue }) => {
    try {
      const { data } = await api.post('/api/harmonization/schema-map', cleanParams({
        a: { columns: a.columns, sampleRows: a.sampleRows ?? [] },
        b: { columns: b.columns, sampleRows: b.sampleRows ?? [] },
        sourceAId,
        sourceBId,
      }));
      return asList(data, 'mappings').map(mapMapping);
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
);

const harmonizationSlice = createSlice({
  name: 'harmonization',
  initialState: {
    matches: [],
    matchesStatus: 'idle',
    matchesError: null,
    runStatus: 'idle',
    runError: null,
    lastRunResult: null,
    matchDetail: null,
    matchDetailStatus: 'idle',
    mappings: [],
    mappingsStatus: 'idle',
    suggested: [],
    suggestStatus: 'idle',
    suggestError: null,
  },
  reducers: {
    resetRunStatus(state) { state.runStatus = 'idle'; state.runError = null; },
    clearMatchDetail(state) { state.matchDetail = null; state.matchDetailStatus = 'idle'; },
    clearSuggested(state) { state.suggested = []; state.suggestStatus = 'idle'; state.suggestError = null; },
    clearErrors(state) { state.matchesError = null; state.runError = null; state.suggestError = null; },
  },
  extraReducers: (b) => {
    b.addCase(runMatching.pending, (s) => { s.runStatus = 'loading'; s.runError = null; })
      .addCase(runMatching.fulfilled, (s, a) => { s.runStatus = 'succeeded'; s.lastRunResult = a.payload; })
      .addCase(runMatching.rejected, (s, a) => { s.runStatus = 'failed'; s.runError = a.payload; })

      .addCase(fetchMatches.pending, (s) => { s.matchesStatus = 'loading'; s.matchesError = null; })
      .addCase(fetchMatches.fulfilled, (s, a) => { s.matchesStatus = 'succeeded'; s.matches = a.payload; })
      .addCase(fetchMatches.rejected, (s, a) => { s.matchesStatus = 'failed'; s.matchesError = a.payload; })

      .addCase(fetchMatchDetail.pending, (s) => { s.matchDetailStatus = 'loading'; })
      .addCase(fetchMatchDetail.fulfilled, (s, a) => { s.matchDetailStatus = 'succeeded'; s.matchDetail = a.payload; })
      .addCase(fetchMatchDetail.rejected, (s) => { s.matchDetailStatus = 'failed'; s.matchDetail = null; })

      .addCase(fetchMappings.pending, (s) => { s.mappingsStatus = 'loading'; })
      .addCase(fetchMappings.fulfilled, (s, a) => { s.mappingsStatus = 'succeeded'; s.mappings = a.payload; })
      .addCase(fetchMappings.rejected, (s) => { s.mappingsStatus = 'failed'; })

      .addCase(suggestMappings.pending, (s) => { s.suggestStatus = 'loading'; s.suggestError = null; })
      .addCase(suggestMappings.fulfilled, (s, a) => { s.suggestStatus = 'succeeded'; s.suggested = a.payload; })
      .addCase(suggestMappings.rejected, (s, a) => { s.suggestStatus = 'failed'; s.suggestError = a.payload; });
  },
});

export const { resetRunStatus, clearMatchDetail, clearSuggested, clearErrors } = harmonizationSlice.actions;

export const selectMatches = (s) => s.harmonization.matches;
export const selectMatchesStatus = (s) => s.harmonization.matchesStatus;
export const selectMatchesError = (s) => s.harmonization.matchesError;
export const selectRunStatus = (s) => s.harmonization.runStatus;
export const selectRunError = (s) => s.harmonization.runError;
export const selectLastRunResult = (s) => s.harmonization.lastRunResult;
export const selectMatchDetail = (s) => s.harmonization.matchDetail;
export const selectMatchDetailStatus = (s) => s.harmonization.matchDetailStatus;
export const selectMappings = (s) => s.harmonization.mappings;
export const selectMappingsStatus = (s) => s.harmonization.mappingsStatus;
export const selectSuggested = (s) => s.harmonization.suggested;
export const selectSuggestStatus = (s) => s.harmonization.suggestStatus;
export const selectSuggestError = (s) => s.harmonization.suggestError;

export default harmonizationSlice.reducer;
