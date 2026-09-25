import { createAsyncThunk, createSelector, createSlice } from '@reduxjs/toolkit';
import api, { asList, cleanParams, errorMessage } from '../../api/client';

// Live pipeline activity (pipeline_jobs) and the audit trail.

export const mapJob = (j) => ({
  id: String(j.id),
  jobType: j.job_type,
  wardId: j.ward_id ?? null,
  sourceId: j.source_id ?? null,
  status: j.status ?? 'queued',
  attempts: Number(j.attempts ?? 0),
  result: j.result ?? null,
  error: j.error ?? null,
  createdAt: j.created_at ?? null,
  startedAt: j.started_at ?? null,
  finishedAt: j.finished_at ?? null,
});

export const mapAudit = (a) => ({
  id: String(a.id),
  actor: a.actor_email ?? a.actor ?? 'system',
  action: a.action,
  entity: a.entity,
  detail: a.detail ?? {},
  createdAt: a.created_at,
});

export const fetchJobs = createAsyncThunk('jobs/fetchJobs', async ({ wardId, sourceId, status, limit = 50 } = {}, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/jobs', { params: cleanParams({ wardId, sourceId, status, limit }) });
    return asList(data, 'jobs').map(mapJob);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchAudit = createAsyncThunk('jobs/fetchAudit', async ({ entity, action, limit = 100 } = {}, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/audit', { params: cleanParams({ entity, action, limit }) });
    return asList(data, 'entries').map(mapAudit);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

const jobsSlice = createSlice({
  name: 'jobs',
  initialState: { items: [], status: 'idle', error: null, audit: [], auditStatus: 'idle' },
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchJobs.pending, (s) => { if (s.status === 'idle') s.status = 'loading'; })
      .addCase(fetchJobs.fulfilled, (s, a) => { s.status = 'succeeded'; s.items = a.payload; s.error = null; })
      .addCase(fetchJobs.rejected, (s, a) => { s.status = 'failed'; s.error = a.payload; })
      .addCase(fetchAudit.pending, (s) => { s.auditStatus = 'loading'; })
      .addCase(fetchAudit.fulfilled, (s, a) => { s.auditStatus = 'succeeded'; s.audit = a.payload; })
      .addCase(fetchAudit.rejected, (s) => { s.auditStatus = 'failed'; });
  },
});

export const selectJobs = (s) => s.jobs.items;
export const selectJobsStatus = (s) => s.jobs.status;
export const selectActiveJobs = createSelector([selectJobs], (items) => items.filter((j) => j.status === 'queued' || j.status === 'running'));
export const selectAudit = (s) => s.jobs.audit;
export const selectAuditStatus = (s) => s.jobs.auditStatus;

export default jobsSlice.reducer;
