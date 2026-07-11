import { describe, expect, it } from 'vitest';

import { DEV_GATES, gateFailureMode } from './dev-gates';

describe('DEV_GATES severity/timeout table (the soft→hard fence)', () => {
  it('pins the exact severity + timeout of every gate', () => {
    expect(
      Object.values(DEV_GATES).map((g) => [g.name, g.severity, g.timeoutMs]),
    ).toEqual([
      ['assertPortFree', 'hard', 1_000],
      ['wait-on convex tcp', 'hard', 180_000],
      ['sandbox-llm-gateway', 'soft', 30_000],
      ['/api/auth/ok', 'soft', 90_000],
      ['vite bind', 'soft', 180_000],
      ['node executor probe', 'hard', 120_000],
    ]);
  });

  it('keeps the auth gate SOFT (a hard fail would strand the WS)', () => {
    expect(DEV_GATES.authOk.severity).toBe('soft');
  });

  it('keeps the node executor probe HARD (#2631 — a broken executor must fail the boot, not degrade silently)', () => {
    expect(DEV_GATES.nodeExecutor.severity).toBe('hard');
  });

  it('maps severity to fail-the-fleet vs degrade-and-continue', () => {
    expect(gateFailureMode('hard')).toBe('fail');
    expect(gateFailureMode('soft')).toBe('degrade');
  });
});
