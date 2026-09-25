import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { errorMessage } from '../../api/client';

/** Pipeline config piggybacks on GET /api/stats (data_mode, pipeline_status, last_refresh, ndbi_threshold). */
export const fetchAdminConfig = createAsyncThunk('admin/fetchAdminConfig', async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/stats');
    return {
      dataMode: data?.data_mode ?? 'demo',
      pipelineStatus: data?.pipeline_status ?? 'idle',
      lastRefresh: data?.last_refresh ?? null,
      ndbiThreshold: data?.ndbi_threshold != null ? Number(data.ndbi_threshold) : 0.15,
    };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** Public health probe: db / redis (job queue) / r2 (object storage). */
export const fetchHealth = createAsyncThunk('admin/fetchHealth', async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/health');
    return data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** Backend persists only ndbi_threshold, min_area_sqm and cloud_cover_max. */
export const saveConfig = createAsyncThunk('admin/saveConfig', async (config, { rejectWithValue }) => {
  try {
    await api.post('/api/admin/db-config', config);
    return config;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** Re-runs harmonization for every ward. */
export const triggerRefresh = createAsyncThunk('admin/triggerRefresh', async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/api/admin/refresh');
    return data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

const adminSlice = createSlice({
  name: 'admin',
  initialState: {
    dataMode: 'demo',
    pipelineStatus: 'idle',
    lastRefresh: null,
    ndbiThreshold: 0.15,
    configStatus: 'idle',
    health: null,
    healthStatus: 'idle',
    saveStatus: 'idle',
    refreshResult: null,
    error: null,
  },
  reducers: {
    resetSaveStatus(state) { state.saveStatus = 'idle'; },
  },
  extraReducers: (b) => {
    b.addCase(fetchAdminConfig.pending, (s) => { if (s.configStatus === 'idle') s.configStatus = 'loading'; })
      .addCase(fetchAdminConfig.fulfilled, (s, a) => { s.configStatus = 'succeeded'; Object.assign(s, a.payload); })
      .addCase(fetchAdminConfig.rejected, (s, a) => { s.configStatus = 'failed'; s.error = a.payload; })

      .addCase(fetchHealth.pending, (s) => { s.healthStatus = 'loading'; })
      .addCase(fetchHealth.fulfilled, (s, a) => { s.healthStatus = 'succeeded'; s.health = a.payload; })
      .addCase(fetchHealth.rejected, (s, a) => { s.healthStatus = 'failed'; s.health = { status: 'down', error: a.payload }; })

      .addCase(saveConfig.pending, (s) => { s.saveStatus = 'loading'; })
      .addCase(saveConfig.fulfilled, (s, a) => {
        s.saveStatus = 'succeeded';
        if (a.payload.ndbi_threshold != null) s.ndbiThreshold = Number(a.payload.ndbi_threshold);
      })
      .addCase(saveConfig.rejected, (s, a) => { s.saveStatus = 'failed'; s.error = a.payload; })

      .addCase(triggerRefresh.pending, (s) => { s.pipelineStatus = 'running'; })
      .addCase(triggerRefresh.fulfilled, (s, a) => { s.pipelineStatus = 'running'; s.refreshResult = a.payload; })
      .addCase(triggerRefresh.rejected, (s, a) => { s.pipelineStatus = 'failed'; s.error = a.payload; });
  },
});

export const { resetSaveStatus } = adminSlice.actions;

export const selectDataMode = (s) => s.admin.dataMode;
export const selectPipelineStatus = (s) => s.admin.pipelineStatus;
export const selectLastRefresh = (s) => s.admin.lastRefresh;
export const selectNdbiThreshold = (s) => s.admin.ndbiThreshold;
export const selectConfigStatus = (s) => s.admin.configStatus;
export const selectHealth = (s) => s.admin.health;
export const selectHealthStatus = (s) => s.admin.healthStatus;
export const selectSaveStatus = (s) => s.admin.saveStatus;
export const selectAdminError = (s) => s.admin.error;

export default adminSlice.reducer;
