import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { asList, cleanParams, errorMessage } from '../../api/client';

export const mapAPIToUI = (t) => ({
  id: String(t.id),
  wardId: t.ward_id != null ? String(t.ward_id) : null,
  wardName: t.ward_name ?? null,
  propertyId: t.property_id ?? null,
  houseNumber: t.house_number ?? '',
  description: t.description ?? '',
  taxPending: t.tax_pending != null ? Number(t.tax_pending) : null,
  photoS3Key: t.photo_s3_key ?? t.photo_r2_key ?? null,
  photoUrl: t.photo_url ?? null,
  status: t.status ?? 'open',
  supervisorNotes: t.supervisor_notes ?? '',
  reviewedBy: t.reviewed_by ?? null,
  reviewedAt: t.reviewed_at ?? null,
  createdAt: t.created_at ?? null,
  updatedAt: t.updated_at ?? null,
});

/** UI → backend CreateTicketDto (camelCase, as validated by class-validator). */
export const mapUIToAPI = (u) => cleanParams({
  wardId: u.wardId != null ? String(u.wardId) : undefined,
  propertyId: u.propertyId || undefined,
  houseNumber: u.houseNumber,
  description: u.description,
  taxPending: u.taxPending === '' || u.taxPending == null ? undefined : Number(u.taxPending),
  photoR2Key: u.photoS3Key || undefined,
});

export const fetchTickets = createAsyncThunk('tickets/fetchTickets', async ({ wardId, status } = {}, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/api/tickets', { params: cleanParams({ wardId, status }) });
    return asList(data, 'tickets').map(mapAPIToUI);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchTicketById = createAsyncThunk('tickets/fetchTicketById', async (id, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/api/tickets/${id}`);
    return mapAPIToUI(data?.ticket ?? data);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const createTicket = createAsyncThunk('tickets/createTicket', async (ui, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/api/tickets', mapUIToAPI(ui));
    return data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** Returns `{ upload_url, s3_key }`; the caller PUTs the file to `upload_url`. */
export const getPhotoUploadUrl = createAsyncThunk('tickets/getPhotoUploadUrl', async (filename, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/api/tickets/photo-upload', { filename });
    return { upload_url: data.upload_url, s3_key: data.s3_key ?? data.r2_key };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const reviewTicket = createAsyncThunk(
  'tickets/reviewTicket',
  async ({ ticketId, status, supervisorNotes, reviewedBy = 'supervisor' }, { rejectWithValue }) => {
    try {
      await api.patch(`/api/tickets/${ticketId}/review`, cleanParams({ status, supervisorNotes, reviewedBy }));
      return { id: String(ticketId), status, supervisorNotes, reviewedBy };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
);

const ticketsSlice = createSlice({
  name: 'tickets',
  initialState: {
    items: [],
    status: 'idle',
    error: null,
    createStatus: 'idle',
    createError: null,
    reviewStatus: 'idle',
    reviewError: null,
  },
  reducers: {
    resetCreateStatus(state) { state.createStatus = 'idle'; state.createError = null; },
    resetReviewStatus(state) { state.reviewStatus = 'idle'; state.reviewError = null; },
    clearErrors(state) { state.error = null; state.createError = null; state.reviewError = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchTickets.pending, (s) => { s.status = 'loading'; s.error = null; })
      .addCase(fetchTickets.fulfilled, (s, a) => { s.status = 'succeeded'; s.items = a.payload; })
      .addCase(fetchTickets.rejected, (s, a) => { s.status = 'failed'; s.error = a.payload; s.items = []; })
      .addCase(fetchTicketById.fulfilled, (s, a) => {
        const i = s.items.findIndex((t) => t.id === a.payload.id);
        if (i >= 0) s.items[i] = { ...s.items[i], ...a.payload };
      })
      .addCase(createTicket.pending, (s) => { s.createStatus = 'loading'; s.createError = null; })
      .addCase(createTicket.fulfilled, (s) => { s.createStatus = 'succeeded'; })
      .addCase(createTicket.rejected, (s, a) => { s.createStatus = 'failed'; s.createError = a.payload; })
      .addCase(reviewTicket.pending, (s) => { s.reviewStatus = 'loading'; s.reviewError = null; })
      .addCase(reviewTicket.fulfilled, (s, a) => {
        s.reviewStatus = 'succeeded';
        const t = s.items.find((x) => x.id === a.payload.id);
        if (t) Object.assign(t, { status: a.payload.status, supervisorNotes: a.payload.supervisorNotes ?? t.supervisorNotes });
      })
      .addCase(reviewTicket.rejected, (s, a) => { s.reviewStatus = 'failed'; s.reviewError = a.payload; });
  },
});

export const { resetCreateStatus, resetReviewStatus, clearErrors } = ticketsSlice.actions;

export const selectTickets = (s) => s.tickets.items;
export const selectTicketsStatus = (s) => s.tickets.status;
export const selectTicketsError = (s) => s.tickets.error;
export const selectCreateStatus = (s) => s.tickets.createStatus;
export const selectCreateError = (s) => s.tickets.createError;
export const selectReviewStatus = (s) => s.tickets.reviewStatus;
export const selectReviewError = (s) => s.tickets.reviewError;

export default ticketsSlice.reducer;
