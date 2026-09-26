import { describe, expect, it } from 'vitest';
import { normalizeBase } from '../api/env';

describe('normalizeBase', () => {
  it('adds https:// to a bare host so calls are not relative to the frontend', () => {
    expect(normalizeBase('gvmc-naksha-production.up.railway.app')).toBe('https://gvmc-naksha-production.up.railway.app');
  });

  it('uses http:// for localhost', () => {
    expect(normalizeBase('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeBase('127.0.0.1:3000/')).toBe('http://127.0.0.1:3000');
  });

  it('keeps full URLs and strips trailing slashes and whitespace', () => {
    expect(normalizeBase(' https://api.example.com/ ')).toBe('https://api.example.com');
    expect(normalizeBase('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeBase('HTTPS://API.example.com//')).toBe('HTTPS://API.example.com');
  });

  it('leaves empty and same-origin relative bases alone', () => {
    expect(normalizeBase('')).toBe('');
    expect(normalizeBase(undefined)).toBe('');
    expect(normalizeBase('/api')).toBe('/api');
  });
});
