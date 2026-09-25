import { Pool } from 'pg';

/** Append-only audit trail (audit_logs). `actor` is the auth user id when known. */
export function audit(pg: Pool, actor: string | undefined, action: string, entity: string, detail: object = {}) {
  const uuid = /^[0-9a-f-]{36}$/i.test(actor ?? '') ? actor : null;
  return pg.query(`INSERT INTO audit_logs (actor, action, entity, detail) VALUES ($1,$2,$3,$4)`, [uuid, action, entity, detail]);
}
