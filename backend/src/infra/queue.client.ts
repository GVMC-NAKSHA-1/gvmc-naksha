import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { createClient, RedisClientType } from 'redis';
import { PG_POOL } from './tokens';

@Injectable()
export class Queue implements OnModuleDestroy {
  private readonly log = new Logger(Queue.name);
  private client: RedisClientType = createClient({ url: process.env.REDIS_URL });

  constructor(@Inject(PG_POOL) private readonly pg: Pool) {}

  // Connect lazily on first use, not at construction — a Redis blip during boot must not
  // crash the process with an unhandled rejection.
  private async ready(): Promise<void> {
    if (!this.client.isOpen && !this.client.isReady) {
      await this.client.connect();
    }
  }

  /** Pushes a worker job and records it in `pipeline_jobs` so the UI can follow its progress. */
  async enqueue(stream: 'ingest', job: Record<string, unknown>) {
    await this.ready();
    const jobId = randomUUID();
    try {
      await this.pg.query(
        `INSERT INTO pipeline_jobs (id, job_type, ward_id, source_id, payload) VALUES ($1,$2,$3,$4,$5)`,
        [jobId, job.jobType, job.wardId ?? null, job.sourceId ?? null, job],
      );
    } catch (e) {
      // Job tracking is best-effort (e.g. migration 0012 not applied yet) — never block the job.
      this.log.warn(`pipeline_jobs insert failed: ${e}`);
    }
    await this.client.lPush(`queue:${stream}`, JSON.stringify({ jobId, ...job }));
    return jobId;
  }

  async ping(): Promise<'ok' | 'down'> {
    try {
      await this.ready();
      return (await this.client.ping()) === 'PONG' ? 'ok' : 'down';
    } catch {
      return 'down';
    }
  }

  onModuleDestroy() {
    return this.client.isOpen ? this.client.quit() : undefined;
  }
}
