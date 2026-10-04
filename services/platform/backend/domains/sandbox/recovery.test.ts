// @vitest-environment node
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { claimRecoveryResume, visitRecoveryCandidates } from './recovery';

describe('agent recovery budgets', () => {
  it('bounds parallel probes and stops starting work when cancelled', async () => {
    const abort = new AbortController();
    const visits: number[] = [];
    let active = 0;
    let peak = 0;
    const walk = visitRecoveryCandidates(
      Array.from({ length: 25 }, (_, i) => i),
      abort.signal,
      async (row, signal) => {
        visits.push(row);
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        active--;
      },
    );
    await Promise.resolve();
    abort.abort();
    await walk;
    expect(peak).toBe(4);
    expect(visits).toHaveLength(4);
    expect(active).toBe(0);
  });

  it('only the insert winner claims a missing op', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const sql = Object.assign(query, {
      begin: (body: (tx: unknown) => unknown) => body(query),
    }) as unknown as Sql;
    const won = await claimRecoveryResume(sql, {
      sessionId: 'session',
      execId: 'exec',
      staleBeforeMs: Date.now(),
      createMissing: {
        organizationId: 'org',
        kind: 'task-agent',
        deadlineMs: Date.now() + 1000,
      },
    });
    expect(won).toBe(false);
  });
});
