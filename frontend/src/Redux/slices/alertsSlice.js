import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { agentApi, asList, cleanParams, errorMessage } from '../../api/client';

export const mapAPIToUI = (a) => ({
  id: String(a.id ?? a.alert_id ?? Math.random()),
  severity: a.severity ?? 'info',
  text: a.text ?? a.message ?? '',
  score: a.score ?? null,
  wardId: a.ward_id != null ? String(a.ward_id) : null,
  createdAt: a.created_at ?? new Date().toISOString(),
});

export const fetchAlerts = createAsyncThunk('alerts/fetchAlerts', async (wardId, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/api/wards/${wardId}/alerts`);
    return asList(data, 'alerts').map(mapAPIToUI);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** Backend: POST /api/alerts/generate { wardId } → stored alert row (older agent API: { alert }). */
export const generateWardAlert = createAsyncThunk(
  'alerts/generateWardAlert',
  async (wardId, { dispatch, rejectWithValue }) => {
    try {
      const { data } = await agentApi.post('/api/alerts/generate', { wardId: String(wardId) });
      const alert = mapAPIToUI(data?.alert ?? data ?? {});
      dispatch(fetchAlerts(wardId));
      return alert;
    } catch (err) {
      return rejectWithValue(err.response?.data?.detail ?? errorMessage(err));
    }
  },
);

export const exportAlerts = createAsyncThunk('alerts/exportAlerts', async (wardId, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/api/alerts/export', {}, { params: cleanParams({ ward_id: wardId }) });
    return { url: data?.presigned_url ?? data?.url ?? null, rowCount: data?.row_count ?? null };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

const alertsSlice = createSlice({
  name: 'alerts',
  initialState: {
    items: [],
    status: 'idle',
    exportStatus: 'idle',
    generateStatus: 'idle',
    generateError: null,
    lastGenerated: null,
    error: null,
  },
  reducers: {
    resetGenerateStatus(state) { state.generateStatus = 'idle'; state.generateError = null; state.lastGenerated = null; },
    resetExportStatus(state) { state.exportStatus = 'idle'; },
    clearErrors(state) { state.error = null; state.generateError = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchAlerts.pending, (s) => { s.status = 'loading'; s.error = null; })
      .addCase(fetchAlerts.fulfilled, (s, a) => { s.status = 'succeeded'; s.items = a.payload; })
      .addCase(fetchAlerts.rejected, (s, a) => { s.status = 'failed'; s.error = a.payload; s.items = []; })
      .addCase(generateWardAlert.pending, (s) => { s.generateStatus = 'loading'; s.generateError = null; })
      .addCase(generateWardAlert.fulfilled, (s, a) => { s.generateStatus = 'succeeded'; s.lastGenerated = a.payload; })
      .addCase(generateWardAlert.rejected, (s, a) => { s.generateStatus = 'failed'; s.generateError = a.payload; })
      .addCase(exportAlerts.pending, (s) => { s.exportStatus = 'loading'; })
      .addCase(exportAlerts.fulfilled, (s) => { s.exportStatus = 'succeeded'; })
      .addCase(exportAlerts.rejected, (s, a) => { s.exportStatus = 'failed'; s.error = a.payload; });
  },
});

export const { resetGenerateStatus, resetExportStatus, clearErrors } = alertsSlice.actions;

export const selectAlerts = (s) => s.alerts.items;
export const selectAlertsStatus = (s) => s.alerts.status;
export const selectAlertsError = (s) => s.alerts.error;
export const selectGenerateStatus = (s) => s.alerts.generateStatus;
export const selectGenerateError = (s) => s.alerts.generateError;
export const selectLastGenerated = (s) => s.alerts.lastGenerated;
export const selectExportStatus = (s) => s.alerts.exportStatus;

export default alertsSlice.reducer;
