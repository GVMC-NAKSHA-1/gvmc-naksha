import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { R2 } from './r2.client';
import { Queue } from './queue.client';
import { Brevo } from './email.client';

import { PG_POOL } from './tokens';

export const PG = PG_POOL;

@Global()
@Module({
  providers: [
    { provide: PG, useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL, max: 10 }) },
    R2, Queue, Brevo,
  ],
  exports: [PG, R2, Queue, Brevo],
})
export class InfraModule {}
