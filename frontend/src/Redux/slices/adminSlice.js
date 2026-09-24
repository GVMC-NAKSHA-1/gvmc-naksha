import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { errorMessage } from '../../api/client';

/** Admin config piggybacks on GET /api/stats (data_mode, pipeline_status, last_refresh, ndbi_threshold). */
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

/** Backend expects JSON `{ fileContent (base64), filename }`. */
export const uploadCSV = createAsyncThunk('admin/uploadCSV', async (file, { rejectWithValue }) => {
  try {
    const fileContent = await fileToBase64(file);
    const { data } = await api.post('/api/admin/upload-csv', { fileContent, filename: file.name });
    return { propertiesImported: Number(data?.properties_imported ?? 0), message: data?.message ?? null };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const saveDbConfig = createAsyncThunk('admin/saveDbConfig', async (config, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/api/admin/db-config', config);
    return { config, data };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const triggerRefresh = createAsyncThunk('admin/triggerRefresh', async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/api/admin/refresh');
    return data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const initialState = {
  dataMode: 'demo',
  pipelineStatus: 'idle',
  lastRefresh: null,
  ndbiThreshold: 0.15,
  uploadStatus: 'idle',
  uploadError: null,
  uploadResult: null,
  configStatus: 'idle',
  saveStatus: 'idle',
  error: null,
};

const adminSlice = createSlice({
  name: 'admin',
  initialState,
  reducers: {
    setDataMode(state, action) { state.dataMode = action.payload; },
    resetUploadStatus(state) { state.uploadStatus = 'idle'; state.uploadError = null; state.uploadResult = null; },
    resetSaveStatus(state) { state.saveStatus = 'idle'; },
    clearErrors(state) { state.error = null; state.uploadError = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchAdminConfig.pending, (s) => { if (s.configStatus === 'idle') s.configStatus = 'loading'; })
      .addCase(fetchAdminConfig.fulfilled, (s, a) => { s.configStatus = 'succeeded'; Object.assign(s, a.payload); })
      .addCase(fetchAdminConfig.rejected, (s, a) => { s.configStatus = 'failed'; s.error = a.payload; })

      .addCase(uploadCSV.pending, (s) => { s.uploadStatus = 'loading'; s.uploadError = null; })
      .addCase(uploadCSV.fulfilled, (s, a) => { s.uploadStatus = 'succeeded'; s.uploadResult = a.payload; s.dataMode = 'live'; })
      .addCase(uploadCSV.rejected, (s, a) => { s.uploadStatus = 'failed'; s.uploadError = a.payload; })

      .addCase(saveDbConfig.pending, (s) => { s.saveStatus = 'loading'; })
      .addCase(saveDbConfig.fulfilled, (s, a) => {
        s.saveStatus = 'succeeded';
        if (a.payload.config.ndbi_threshold != null) s.ndbiThreshold = Number(a.payload.config.ndbi_threshold);
      })
      .addCase(saveDbConfig.rejected, (s, a) => { s.saveStatus = 'failed'; s.error = a.payload; })

      .addCase(triggerRefresh.pending, (s) => { s.pipelineStatus = 'running'; })
      .addCase(triggerRefresh.fulfilled, (s) => { s.pipelineStatus = 'running'; })
      .addCase(triggerRefresh.rejected, (s, a) => { s.pipelineStatus = 'failed'; s.error = a.payload; });
  },
});

export const { setDataMode, resetUploadStatus, resetSaveStatus, clearErrors } = adminSlice.actions;

export const selectDataMode = (s) => s.admin.dataMode;
export const selectPipelineStatus = (s) => s.admin.pipelineStatus;
export const selectLastRefresh = (s) => s.admin.lastRefresh;
export const selectNdbiThreshold = (s) => s.admin.ndbiThreshold;
export const selectUploadStatus = (s) => s.admin.uploadStatus;
export const selectUploadError = (s) => s.admin.uploadError;
export const selectUploadResult = (s) => s.admin.uploadResult;
export const selectConfigStatus = (s) => s.admin.configStatus;
export const selectAdminError = (s) => s.admin.error;

export default adminSlice.reducer;
