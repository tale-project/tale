import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AutoRetryRunFacts } from '../../core/tasks/task_auto_retry.ts';
import { admitAutomatedStart } from './delegated-start.ts';
import { recordActivity } from './service.ts';

vi.mock('./service.ts', () => ({ recordActivity: vi.fn() }));

const NOW = 10_000_000;
const HOUR_MS = 3_600_000;
const task = { id: 'task-1', organizationId: 'org-1', projectId: 'project-1' };

interface Run extends AutoRetryRunFacts {
  startedAt: number;
  automated: boolean;
}

function run(startedAt: number, fields: Partial<Run> = {}): Run {
  return {
    agentId: 'agent-1',
    status: 'failed',
    failureCode: 'harness_error',
    startedAt,
    automated: true,
    ...fields,
  };
}

async function admit(history: Run[]) {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const query = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const text = strings.join('?');
    if (!text.includes('FROM app.project_agent_runs'))
      return Promise.resolve([]);
    return Promise.resolve(
      text.includes('ORDER BY started_at_ms')
        ? history.toSorted((a, b) => a.startedAt - b.startedAt)
        : history,
    );
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the admission uses only the transaction's SQL tag; rows model its ordered history read
  return admitAutomatedStart(query as unknown as TransactionSql, {
    task,
    agentId: 'agent-1',
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(recordActivity).mockClear();
});

describe('automated start budget after a broker cooldown [TASK-R12]', () => {
  it('does not count a cooldown after its own 429 as another automated start', async () => {
    await expect(
      admit([
        run(NOW - 1_000, { failureCode: 'credential_cooldown' }),
        run(NOW - 2_000, { apiErrorStatus: 429 }),
        run(NOW - 3_000),
      ]),
    ).resolves.toEqual({ admitted: true });
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it('uses the predecessor outside the hour without counting it', async () => {
    await expect(
      admit([
        run(NOW - 1_000),
        run(NOW - 2_000),
        run(NOW - HOUR_MS + 1_000, { failureCode: 'credential_cooldown' }),
        run(NOW - HOUR_MS - 1_000, { apiErrorStatus: 429 }),
      ]),
    ).resolves.toEqual({ admitted: true });
  });

  it('does not count human runs but keeps them in the cooldown adjacency', async () => {
    await expect(
      admit([
        run(NOW - 1_000, { failureCode: 'credential_cooldown' }),
        run(NOW - 2_000, { automated: false }),
        run(NOW - 3_000, { apiErrorStatus: 429 }),
        run(NOW - 4_000),
      ]),
    ).resolves.toEqual({ admitted: false, retryAfter: NOW - 4_000 + HOUR_MS });
  });

  it('counts a second consecutive cooldown so refusals cannot bypass the cap', async () => {
    await expect(
      admit([
        run(NOW - 1_000, { failureCode: 'credential_cooldown' }),
        run(NOW - 2_000, { failureCode: 'credential_cooldown' }),
        run(NOW - 3_000, { apiErrorStatus: 429 }),
        run(NOW - 4_000),
      ]),
    ).resolves.toEqual({ admitted: false, retryAfter: NOW - 4_000 + HOUR_MS });
  });

  it('keeps three actual starts counted and bases retryAfter on the oldest counted start', async () => {
    await expect(
      admit([
        run(NOW - 1_000),
        run(NOW - 2_000),
        run(NOW - 3_000),
        run(NOW - 4_000, { failureCode: 'credential_cooldown' }),
        run(NOW - HOUR_MS - 1_000, { apiErrorStatus: 429 }),
      ]),
    ).resolves.toEqual({ admitted: false, retryAfter: NOW - 3_000 + HOUR_MS });
    expect(recordActivity).toHaveBeenCalledWith(expect.anything(), {
      task,
      actorType: 'agent',
      actorId: 'agent-1',
      action: 'agent_run.refused',
      toValue: 'task_circuit_breaker',
    });
  });

  it.each([
    ['a different agent', { agentId: 'agent-2', apiErrorStatus: 429 }],
    ['a successful run', { status: 'settled' as const, apiErrorStatus: 429 }],
    ['another failure', {}],
  ])('counts a cooldown after %s', async (_label, predecessor) => {
    await expect(
      admit([
        run(NOW - 1_000, { failureCode: 'credential_cooldown' }),
        run(NOW - 2_000, predecessor),
        run(NOW - 3_000),
      ]),
    ).resolves.toEqual({ admitted: false, retryAfter: NOW - 3_000 + HOUR_MS });
  });
});
