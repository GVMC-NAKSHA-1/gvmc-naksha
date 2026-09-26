import { errorStatus, friendlyError } from './errors';

describe('friendlyError', () => {
  it('reads the status from axios messages and bare status text', () => {
    expect(errorStatus('Request failed with status code 405')).toBe(405);
    expect(errorStatus('Method Not Allowed')).toBe(405);
    expect(errorStatus('Network Error')).toBe(0);
    expect(errorStatus('Ward 412 has no parcels')).toBeNull();
  });

  it('hides the raw text behind a plain message but keeps it as detail', () => {
    const e = friendlyError('Request failed with status code 405');
    expect(e.message).not.toMatch(/405|Method/);
    expect(e.detail).toBe('Request failed with status code 405');
    expect(friendlyError('Network Error').message).toMatch(/could not be reached/);
    expect(friendlyError('Internal Server Error').message).toMatch(/server ran into a problem/);
    expect(friendlyError(null)).toBeNull();
  });
});
