import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { cleanParams, errorMessage } from '../../api/client';

// Change-detection KPIs (GET /api/stats aggregates the `properties` detections table).

const n = (v) => (v == null ? 0 : Number(v));

export const mapStatsToUI = (d = {}) => ({
  totalDetections: n(d.total_detections),
  newBuilds: n(d.new_builds),
  changeOfUse: n(d.change_of_use),
  pendingVerification: n(d.pending_verification),
  verified: n(d.verified),
  falsePositives: n(d.false_positives),
  wardId: d.ward_id ?? null,
});

export const fetchStats = createAsyncThunk('stats/fetchStats', async ({ wardId } = {}, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/stats', { params: cleanParams({ ward_id: wardId }) });
    return mapStatsToUI(data);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

const statsSlice = createSlice({
  name: 'stats',
  initialState: { wardStats: null, status: 'idle', error: null },
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchStats.pending, (s) => { s.status = 'loading'; s.error = null; })
      .addCase(fetchStats.fulfilled, (s, a) => { s.status = 'succeeded'; s.wardStats = a.payload; })
      .addCase(fetchStats.rejected, (s, a) => { s.status = 'failed'; s.error = a.payload; });
  },
});

export const selectWardStats = (s) => s.stats.wardStats;
export const selectStatsStatus = (s) => s.stats.status;

export default statsSlice.reducer;
