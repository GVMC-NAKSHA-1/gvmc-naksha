import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

// Postgres connection-class SQLSTATEs (08xxx), auth/db-name failures, admin shutdown, and the
// Node network errors a driver surfaces when the DB / Redis host can't be reached.
const UNAVAILABLE = /^(08|28P01$|3D000$|57P0[1-3]$|XX000$|ENOTFOUND$|ECONNREFUSED$|ECONNRESET$|ETIMEDOUT$|EAI_AGAIN$)/;

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('HttpExceptionFilter');

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (err instanceof HttpException) {
      return res.status(err.getStatus()).json({ message: err.message, ...(err.getResponse() as object) });
    }
    const msg = (err as Error)?.message ?? 'Internal server error';
    // Errors carrying a `code` come from pg / redis / the OS, not from our services — their text
    // (e.g. Supabase's "tenant/user … not found") must not be read as a 404 or 400.
    const driverCode = (err as { code?: unknown })?.code;
    if (typeof driverCode === 'string') {
      const unavailable = UNAVAILABLE.test(driverCode) || /tenant\/user .* not found/i.test(msg);
      this.log.error(`${driverCode}: ${msg}`, (err as Error)?.stack);
      return unavailable
        ? res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ message: 'Service unavailable: database or queue connection failed' })
        : res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Internal server error' });
    }
    const code = /not found/i.test(msg) ? HttpStatus.NOT_FOUND
               : /invalid|required|must be/i.test(msg) ? HttpStatus.BAD_REQUEST
               : HttpStatus.INTERNAL_SERVER_ERROR;
    if (code === HttpStatus.INTERNAL_SERVER_ERROR) this.log.error(msg, (err as Error)?.stack);
    return res.status(code).json({ message: code === 500 ? 'Internal server error' : msg });
  }
}
