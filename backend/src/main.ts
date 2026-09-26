import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { assertSafeAuthConfig } from './common/auth-config';

async function bootstrap() {
  assertSafeAuthConfig(process.env);
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // Behind Cloudflare / a reverse proxy, req.ip (used by the rate limiter) must come from
  // X-Forwarded-For, otherwise every client shares the proxy's bucket. e.g. TRUST_PROXY=1
  if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    app.getHttpAdapter().getInstance().set('trust proxy', Number.isNaN(hops) ? process.env.TRUST_PROXY : hops);
  }
  // The SPA is on another origin (Vercel) and loads previews/exports from the API.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.FRONTEND_ORIGIN?.split(',') ?? '*' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());   // LookupError→404, ValueError→400 parity
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
