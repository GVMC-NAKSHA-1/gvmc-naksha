import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { agentApi, errorMessage } from '../../api/client';

export const sendChatMessage = createAsyncThunk('chat/sendChatMessage', async (text, { rejectWithValue }) => {
  try {
    const { data } = await agentApi.post('/api/chat', { message: text });
    return data?.reply ?? data?.response ?? data?.message ?? '';
  } catch (err) {
    return rejectWithValue(err.response?.data?.detail ?? errorMessage(err));
  }
});

const chatSlice = createSlice({
  name: 'chat',
  initialState: { messages: [], status: 'idle', error: null },
  reducers: {
    clearChat(state) { state.messages = []; state.status = 'idle'; state.error = null; },
  },
  extraReducers: (b) => {
    b.addCase(sendChatMessage.pending, (s, a) => {
      s.status = 'loading';
      s.error = null;
      s.messages.push({ role: 'user', content: a.meta.arg });
    })
      .addCase(sendChatMessage.fulfilled, (s, a) => {
        s.status = 'succeeded';
        s.messages.push({ role: 'assistant', content: a.payload || '_(no response)_' });
      })
      .addCase(sendChatMessage.rejected, (s, a) => {
        s.status = 'failed';
        s.error = a.payload;
        s.messages.push({ role: 'assistant', content: `Error: ${a.payload}` });
      });
  },
});

export const { clearChat } = chatSlice.actions;

export const selectChatMessages = (s) => s.chat.messages;
export const selectChatStatus = (s) => s.chat.status;

export default chatSlice.reducer;
