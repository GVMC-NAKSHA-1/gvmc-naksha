import { classifyReadiness, summarizeReadiness } from './readiness';

describe('finalisation readiness', () => {
  it('orders blocking reasons: conflicts, topology, then confidence', () => {
    expect(classifyReadiness({ confidence: 0.95, conflict_count: 1, topology_open: 2 })).toBe('blocked_conflict');
    expect(classifyReadiness({ confidence: 0.95, conflict_count: 0, topology_open: 2 })).toBe('blocked_topology');
    expect(classifyReadiness({ confidence: 0.7, conflict_count: 0, topology_open: 0 })).toBe('low_confidence');
    expect(classifyReadiness({ confidence: null, conflict_count: 0, topology_open: 0 })).toBe('low_confidence');
    expect(classifyReadiness({ confidence: 0.9, conflict_count: 0, topology_open: 0 })).toBe('ready');
  });

  it('summarises a ward', () => {
    const s = summarizeReadiness([
      { confidence: 0.9, conflict_count: 0, topology_open: 0 },
      { confidence: 0.9, conflict_count: 0, topology_open: 0 },
      { confidence: 0.5, conflict_count: 0, topology_open: 0 },
      { confidence: 0.9, conflict_count: 2, topology_open: 0 },
    ]);
    expect(s).toMatchObject({ total: 4, ready: 2, low_confidence: 1, blocked_conflict: 1, ready_pct: 50 });
  });
});
