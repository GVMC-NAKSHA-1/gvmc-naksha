import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../infra/infra.module';
import { R2 } from '../infra/r2.client';
import { Queue } from '../infra/queue.client';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/roles.decorator';

@SkipThrottle()   // load balancers / uptime checks poll this
@Controller('health')
export class HealthController {
  constructor(@Inject(PG) private pg: Pool, private r2: R2, private queue: Queue) {}

  @Public()
  @Get()
  async check() {
    const db = await this.pg.query('SELECT 1').then(() => 'ok' as const).catch(() => 'down' as const);
    const [redis, r2] = await Promise.all([this.queue.ping(), this.r2.ping()]);
    const status = db === 'ok' && redis === 'ok' && r2 === 'ok' ? 'ok' : 'degraded';
    return { status, db, redis, r2, ts: new Date().toISOString() };
  }
}
