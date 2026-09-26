/**
 * Turns the raw error strings stored by the slices (from `errorMessage()` in api/client.js, e.g.
 * "Request failed with status code 405" or "Method Not Allowed") into something a user can act on.
 * The raw text is kept as `detail` so it can still be shown under "Technical details".
 */
const STATUS_TEXT = [
  [/method not allowed/i, 405], [/not found/i, 404], [/unauthori[sz]ed/i, 401], [/forbidden/i, 403],
  [/too many requests/i, 429], [/internal server error/i, 500], [/bad gateway/i, 502],
  [/service unavailable/i, 503], [/gateway time-?out/i, 504],
];

export function errorStatus(raw) {
  const text = String(raw ?? '');
  const code = text.match(/(?:status code|HTTP)\s*(\d{3})/i)?.[1];
  if (code) return Number(code);
  if (/network error|failed to fetch|ERR_CONNECTION/i.test(text)) return 0;
  return STATUS_TEXT.find(([re]) => re.test(text))?.[1] ?? null;
}

export function friendlyError(raw) {
  if (!raw) return null;
  const detail = String(raw);
  const status = errorStatus(detail);
  let message;
  if (status === 0) message = 'The server could not be reached. Check your internet connection and try again.';
  else if (status === 404 || status === 405) message = 'The server did not accept this request. The app may not be connected to the right backend — please ask your administrator to check the API connection.';
  else if (status === 401) message = 'Your session has expired. Please sign in again.';
  else if (status === 403) message = 'You don’t have permission to do this. Ask an administrator for access.';
  else if (status === 429) message = 'Too many requests right now. Wait a moment and try again.';
  else if (status >= 500) message = 'The server ran into a problem. Please try again in a minute.';
  else message = 'Something went wrong. Please try again.';
  return { message, detail: status ? `${detail}${detail.includes(String(status)) ? '' : ` (HTTP ${status})`}` : detail, status };
}
