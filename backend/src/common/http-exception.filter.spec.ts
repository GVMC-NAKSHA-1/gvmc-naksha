import { ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function run(err: unknown) {
  const out: { status?: number; body?: any } = {};
  const res = { status: (s: number) => { out.status = s; return res; }, json: (b: unknown) => { out.body = b; return res; } };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(err, host);
  return out;
}

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

describe('HttpExceptionFilter', () => {
  beforeAll(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));

  it('maps a Supabase pooler "tenant not found" to 503, not 404', () => {
    const r = run(withCode('(ENOTFOUND) tenant/user postgres.abc not found', 'XX000'));
    expect(r.status).toBe(503);
    expect(r.body.message).not.toMatch(/tenant/);
  });

  it('maps unreachable hosts and bad credentials to 503', () => {
    expect(run(withCode('getaddrinfo ENOTFOUND db', 'ENOTFOUND')).status).toBe(503);
    expect(run(withCode('connect ECONNREFUSED', 'ECONNREFUSED')).status).toBe(503);
    expect(run(withCode('password authentication failed', '28P01')).status).toBe(503);
  });

  it('hides other driver errors behind a 500 even if the text says "not found"', () => {
    const r = run(withCode('relation "not found" does not exist', '42P01'));
    expect(r).toEqual({ status: 500, body: { message: 'Internal server error' } });
  });

  it('keeps the service-level mapping for plain errors', () => {
    expect(run(new Error('Ward 9 not found')).status).toBe(404);
    expect(run(new Error('wardId is required')).status).toBe(400);
    expect(run(new NotFoundException('nope')).status).toBe(404);
  });
});
