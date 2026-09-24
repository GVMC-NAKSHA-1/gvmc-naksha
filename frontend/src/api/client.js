import axios from 'axios';
import { AGENT_API_URL, API_URL, MOCK_MODE } from './env';
import { getAccessToken } from './auth';
import { currentDevRole } from './role';

// In mock mode requests stay relative so MSW intercepts them regardless of the API URL.
const baseFor = (url) => (MOCK_MODE ? '' : url);

async function attachAuth(config) {
  const token = await getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  else config.headers['x-dev-role'] = currentDevRole();
  return config;
}

function makeClient(baseURL, label) {
  const instance = axios.create({ baseURL, headers: { 'Content-Type': 'application/json' } });
  instance.interceptors.request.use(attachAuth);
  instance.interceptors.response.use((r) => r, (error) => {
    console.error(`[${label}]`, error.response?.status, error.config?.url, error.message);
    return Promise.reject(error);
  });
  return instance;
}

const api = makeClient(baseFor(API_URL), 'API Error');
export const agentApi = makeClient(baseFor(AGENT_API_URL), 'Agent API Error');

/** Normalises NestJS / FastAPI error bodies into one message. */
export function errorMessage(err) {
  const d = err?.response?.data;
  const msg = d?.message ?? d?.detail ?? err?.message ?? 'Request failed';
  return Array.isArray(msg) ? msg.join(', ') : String(msg);
}

/** Backend list endpoints return either a bare array or `{ <key>: [...] }`. */
export function asList(data, key) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[key])) return data[key];
  return [];
}

/** Drops undefined / null / '' values so they aren't sent as query params. */
export function cleanParams(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

export default api;
