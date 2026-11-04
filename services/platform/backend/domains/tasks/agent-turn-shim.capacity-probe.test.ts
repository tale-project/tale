// @vitest-environment node
/**
 * The turn host marks each call its harness retries on a model at capacity
 * (TASK-R40): the shim hands the mark to the run's renewal as it came — the
 * run, its exec and the wait before the next attempt — and the renewal
 * fences it (`agent-runs.test.ts`).
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { renewAgentRunCapacityProbe } from './agent-runs.ts';
import { agentTurnShimHandlers } from './agent-turn-shim.ts';

vi.mock('./agent-runs.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agent-runs.ts')>()),
  renewAgentRunCapacityProbe: vi.fn().mockResolvedValue(true),
}));

describe('the turn host’s capacity-retry mark [TASK-R40]', () => {
  it('renews the probe’s claim with the run, its exec and the wait', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the renewal is mocked; the shim only passes `sql` on
    const sql = {} as Sql;
    const renew =
      agentTurnShimHandlers(sql)[
        'tasks/agent_runs:renewTaskAgentRunCapacityProbe'
      ];
    const args = { runId: 'run-1', execId: 'exec-1', retryDelayMs: 566 };

    await expect(renew?.(args)).resolves.toBeNull();

    expect(renewAgentRunCapacityProbe).toHaveBeenCalledWith(sql, args);
  });
});
