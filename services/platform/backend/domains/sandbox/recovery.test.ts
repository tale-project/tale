// @vitest-environment node
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  claimRecoveryResume,
  driveJobPending,
  visitRecoveryCandidates,
} from './recovery';

describe('drive queue identity', () => {
  it.each([
    ['automation.agent_drive', 'automation.v2.agent_drive'],
    ['task.agent_drive', 'task.agent_drive'],
  ] as const)(
    'reads only the current physical queue for %s',
    async (queue, physical) => {
      const query = vi.fn().mockResolvedValue([{ pending: true }]);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SQL read capture only
      const sql = query as unknown as Sql;
      expect(
        await driveJobPending(sql, {
          queue,
          execId: 'exec',
          staleBeforeMs: 123_000,
        }),
      ).toBe(true);
      expect(query.mock.calls[0]?.slice(1)).toEqual([physical, 'exec', 123]);
    },
  );
});

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
