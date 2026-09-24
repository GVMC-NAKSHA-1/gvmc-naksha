import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { agentApi, cleanParams, errorMessage } from '../../api/client';

const n = (v) => (v == null ? null : Number(v));

export const mapStatsToUI = (d = {}) => ({
  totalDetections: n(d.total_detections) ?? 0,
  newBuilds: n(d.new_builds) ?? 0,
  changeOfUse: n(d.change_of_use) ?? 0,
  pendingVerification: n(d.pending_verification) ?? 0,
  verified: n(d.verified) ?? 0,
  falsePositives: n(d.false_positives) ?? 0,
  revenueEstimate: n(d.revenue_estimate) ?? 0,
  wardId: d.ward_id ?? null,
});

export const mapWardStatToUI = (w = {}) => ({
  wardId: String(w.ward_id),
  wardName: w.ward_name ?? null,
  unassessedCount: n(w.unassessed_count) ?? 0,
  totalDetections: n(w.total_detections) ?? 0,
  openTickets: n(w.open_tickets) ?? 0,
  resolvedTickets: n(w.resolved_tickets) ?? 0,
  aiBrief: w.ai_brief ?? null,
  avgNdbiDelta: n(w.avg_ndbi_delta),
  maxNdbiDelta: n(w.max_ndbi_delta),
});

export const fetchStats = createAsyncThunk('stats/fetchStats', async ({ wardId } = {}, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/stats', { params: cleanParams({ ward_id: wardId }) });
    return mapStatsToUI(data);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchAllWardsStats = createAsyncThunk('stats/fetchAllWardsStats', async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/stats/all-wards');
    return {
      wards: (data?.wards ?? []).map(mapWardStatToUI),
      aiBrief: data?.ai_brief ?? null,
      totals: data?.totals ? mapStatsToUI(data.totals) : null,
    };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchCommissionerBrief = createAsyncThunk('stats/fetchCommissionerBrief', async (_, { rejectWithValue }) => {
  try {
    const { data } = await agentApi.get('/api/brief');
    return data?.ai_brief ?? '';
  } catch (err) {
    return rejectWithValue(err.response?.data?.detail ?? errorMessage(err));
  }
});

const initialState = {
  wardStats: null,
  allWardsStats: [],
  totals: null,
  aiBrief: null,
  status: 'idle',
  allWardsStatus: 'idle',
  briefStatus: 'idle',
  briefError: null,
  error: null,
};

const statsSlice = createSlice({
  name: 'stats',
  initialState,
  reducers: {
    clearErrors(state) { state.error = null; state.briefError = null; },
    resetStats(state) { state.wardStats = null; state.status = 'idle'; },
  },
  extraReducers: (b) => {
    b.addCase(fetchStats.pending, (s) => { s.status = 'loading'; s.error = null; })
      .addCase(fetchStats.fulfilled, (s, a) => { s.status = 'succeeded'; s.wardStats = a.payload; })
      .addCase(fetchStats.rejected, (s, a) => { s.status = 'failed'; s.error = a.payload; })
      .addCase(fetchAllWardsStats.pending, (s) => { s.allWardsStatus = 'loading'; })
      .addCase(fetchAllWardsStats.fulfilled, (s, a) => {
        s.allWardsStatus = 'succeeded';
        s.allWardsStats = a.payload.wards;
        s.totals = a.payload.totals;
        if (a.payload.aiBrief && !s.aiBrief) s.aiBrief = a.payload.aiBrief;
      })
      .addCase(fetchAllWardsStats.rejected, (s, a) => { s.allWardsStatus = 'failed'; s.error = a.payload; })
      .addCase(fetchCommissionerBrief.pending, (s) => { s.briefStatus = 'loading'; s.briefError = null; })
      .addCase(fetchCommissionerBrief.fulfilled, (s, a) => { s.briefStatus = 'succeeded'; s.aiBrief = a.payload; })
      .addCase(fetchCommissionerBrief.rejected, (s, a) => { s.briefStatus = 'failed'; s.briefError = a.payload; });
  },
});

export const { clearErrors, resetStats } = statsSlice.actions;

export const selectWardStats = (s) => s.stats.wardStats;
export const selectAllWardsStats = (s) => s.stats.allWardsStats;
export const selectCityTotals = (s) => s.stats.totals;
export const selectStatsStatus = (s) => s.stats.status;
export const selectAllWardsStatus = (s) => s.stats.allWardsStatus;
export const selectAiBrief = (s) => s.stats.aiBrief;
export const selectBriefStatus = (s) => s.stats.briefStatus;
export const selectBriefError = (s) => s.stats.briefError;
export const selectStatsError = (s) => s.stats.error;

export default statsSlice.reducer;
