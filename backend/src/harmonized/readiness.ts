// Cadastral finalisation readiness of a golden record.

export type ReadinessInput = { confidence: number | null; conflict_count: number; topology_open: number };
export type Readiness = 'ready' | 'blocked_conflict' | 'blocked_topology' | 'low_confidence';

export const READY_CONFIDENCE = 0.85;

/** Blocking reasons are checked in order of what an officer must fix first. */
export function classifyReadiness(r: ReadinessInput): Readiness {
  if (Number(r.conflict_count) > 0) return 'blocked_conflict';
  if (Number(r.topology_open) > 0) return 'blocked_topology';
  if (r.confidence == null || Number(r.confidence) < READY_CONFIDENCE) return 'low_confidence';
  return 'ready';
}

export function summarizeReadiness(rows: ReadinessInput[]) {
  const counts: Record<Readiness, number> = { ready: 0, blocked_conflict: 0, blocked_topology: 0, low_confidence: 0 };
  for (const r of rows) counts[classifyReadiness(r)] += 1;
  return { total: rows.length, ...counts, ready_pct: rows.length ? Math.round((1000 * counts.ready) / rows.length) / 10 : 0 };
}
