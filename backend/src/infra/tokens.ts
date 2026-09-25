/** Injection token for the shared pg Pool (kept separate to avoid an infra.module ↔ queue.client import cycle). */
export const PG_POOL = 'PG_POOL';
