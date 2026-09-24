import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { asList, cleanParams, errorMessage } from '../../api/client';

export const mapAPIToUI = (c) => ({
  id: String(c.id),
  wardId: c.ward_id != null ? String(c.ward_id) : null,
  matchId: c.match_id ?? null,
  conflictType: c.conflict_type,
  severity: c.severity ?? 'low',
  detail: c.detail ?? {},
  suggestedResolution: c.suggested_resolution ?? '',
  status: c.status ?? 'pending',
  resolvedBy: c.resolved_by ?? null,
  resolvedAt: c.resolved_at ?? null,
});

export const fetchConflicts = createAsyncThunk('conflicts/fetchConflicts', async ({ wardId, status } = {}, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/conflicts', { params: cleanParams({ wardId, status }) });
    return asList(data, 'conflicts').map(mapAPIToUI);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const resolveConflict = createAsyncThunk(
  'conflicts/resolveConflict',
  async ({ id, status = 'resolved', notes, resolvedBy = 'officer' }, { rejectWithValue }) => {
    try {
      await api.post(`/api/conflicts/${id}/resolve`, cleanParams({ status, notes, resolvedBy }));
      return { id: String(id), status, resolvedBy };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
);

const conflictsSlice = createSlice({
  name: 'conflicts',
  initialState: { items: [], status: 'idle', error: null, resolveStatus: 'idle', resolveError: null },
  reducers: {
    resetResolveStatus(state) { state.resolveStatus = 'idle'; state.resolveError = null; },
    clearErrors(state) { state.error = null; state.resolveError = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchConflicts.pending, (s) => { s.status = 'loading'; s.error = null; })
      .addCase(fetchConflicts.fulfilled, (s, a) => { s.status = 'succeeded'; s.items = a.payload; })
      .addCase(fetchConflicts.rejected, (s, a) => { s.status = 'failed'; s.error = a.payload; })
      .addCase(resolveConflict.pending, (s) => { s.resolveStatus = 'loading'; s.resolveError = null; })
      .addCase(resolveConflict.fulfilled, (s, a) => {
        s.resolveStatus = 'succeeded';
        const c = s.items.find((x) => x.id === a.payload.id);
        if (c) Object.assign(c, { status: a.payload.status, resolvedBy: a.payload.resolvedBy });
      })
      .addCase(resolveConflict.rejected, (s, a) => { s.resolveStatus = 'failed'; s.resolveError = a.payload; });
  },
});

export const { resetResolveStatus, clearErrors } = conflictsSlice.actions;

export const selectConflicts = (s) => s.conflicts.items;
export const selectConflictsStatus = (s) => s.conflicts.status;
export const selectConflictsError = (s) => s.conflicts.error;
export const selectResolveStatus = (s) => s.conflicts.resolveStatus;
export const selectResolveError = (s) => s.conflicts.resolveError;

export default conflictsSlice.reducer;
