/**
 * An auto-retry continues its failed run's kick, so it acts for the same
 * person: the retry run's `started_by` is the failed run's, never the
 * agent's creator, the task's creator or a system marker. Spend attribution
 * and the member a task run's connector calls act for both read that column,
 * so a retry that switched it would book and act for someone who did not
 * start the work.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { kickAgentRun } = vi.hoisted(() => ({
  kickAgentRun: vi.fn(async () => ({ runId: 'run-retry' })),
}));

vi.mock('../domains/tasks/agent-runs.ts', () => ({ kickAgentRun }));

import {
  AUTO_RETRY_HISTORY_LIMIT,
  AUTO_RETRY_MAX_ATTEMPTS,
} from '../core/tasks/task_auto_retry.ts';
import { createTaskList } from './task-list.ts';

const PAYLOAD = {
  organizationId: 'org-1',
  taskId: 'task-1',
  agentId: 'agent-1',
  expectedRunId: 'run-failed',
};

/** What the job asked the run history for: the query text and its values. */
const reads: Array<{ text: string; values: unknown[] }> = [];

/** A transaction that answers the job's three reads: the task, its runs
 * newest first, and the agent. */
function sqlWith(runs: Array<Record<string, unknown>>): Sql {
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM app.tasks')) {
      return Promise.resolve([
        {
          status: 'in_progress',
          archivedAt: null,
          projectId: 'project-1',
          assigneeType: 'agent',
          assigneeId: 'agent-1',
        },
      ]);
    }
    if (text.includes('FROM app.project_agent_runs')) {
      reads.push({ text, values });
      return Promise.resolve(runs);
    }
    if (text.includes('FROM app.project_agents')) {
      return Promise.resolve([
        { harness: 'claude-code', model: 'm', modelProvider: null },
      ]);
    }
    throw new Error(`unexpected query: ${text}`);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- postgres.js as far as the retry job uses it
  return {
    begin: async (run: (t: typeof tx) => Promise<unknown>) => run(tx),
  } as unknown as Sql;
}

/** A short failed attempt of agent-1, newest first in the history. */
function failedRun(
  id: string,
  failureCode: string | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    status: 'failed',
    agentId: 'agent-1',
    startedBy: 'user-starter',
    launchedAt: 1_000,
    settledAt: 2_000,
    failureCode,
    ...extra,
  };
}

describe('task.agent_retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.length = 0;
  });

  it.each([
    ['a member', 'user-starter'],
    ['a REST start', 'api-key:user-starter'],
    ['a trigger', 'trigger:schedule-1'],
  ])(
    'kicks the retry as the failed run’s starter (%s)',
    async (_label, startedBy) => {
      const handler = createTaskList({
        sql: sqlWith([
          {
            id: 'run-failed',
            status: 'failed',
            agentId: 'agent-1',
            startedBy,
            launchedAt: 1_000,
            settledAt: 2_000,
          },
        ]),
      })['task.agent_retry'];

      await handler?.(PAYLOAD);

      expect(kickAgentRun).toHaveBeenCalledTimes(1);
      expect(kickAgentRun).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          taskId: 'task-1',
          agentId: 'agent-1',
          startedBy,
          trigger: 'auto_retry',
        }),
      );
    },
  );

  it('resumes a run the broker’s refresh cut, even with the crash-loop budget spent', async () => {
    const handler = createTaskList({
      sql: sqlWith([
        failedRun('run-failed', 'credential_rotated', { autoRetryAttempt: 3 }),
        failedRun('run-3', 'harness_error', { autoRetryAttempt: 2 }),
        failedRun('run-2', 'harness_error', { autoRetryAttempt: 1 }),
        failedRun('run-1', 'harness_error'),
      ]),
    })['task.agent_retry'];

    await handler?.(PAYLOAD);

    expect(kickAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trigger: 'auto_retry',
        // Nothing more spent: the stamp shows what the cut run showed.
        autoRetryAttempt: AUTO_RETRY_MAX_ATTEMPTS,
      }),
    );
    // The codes, statuses and stamps come from the rows, over a window wide
    // enough to see past free rotations and waits.
    expect(reads[0]?.text).toContain('failure_code');
    expect(reads[0]?.text).toContain('api_error_status');
    expect(reads[0]?.text).toContain('auto_retry_attempt');
    expect(reads[0]?.values).toContain(AUTO_RETRY_HISTORY_LIMIT);
  });

  it('stamps a resume after a clean run’s token refresh with no attempt spent', async () => {
    const handler = createTaskList({
      sql: sqlWith([failedRun('run-failed', 'credential_rotated')]),
    })['task.agent_retry'];

    await handler?.(PAYLOAD);

    // 0, not "1 of 3": the card says the run resumed after a token refresh,
    // and the next ordinary failure is the first counted attempt.
    expect(kickAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ trigger: 'auto_retry', autoRetryAttempt: 0 }),
    );
  });

  it('waits out the cooldown of its own 429 without spending an attempt', async () => {
    const handler = createTaskList({
      sql: sqlWith([
        failedRun('run-failed', 'credential_cooldown', {
          launchedAt: null,
          autoRetryAttempt: 1,
        }),
        failedRun('run-1', 'harness_error', { apiErrorStatus: 429 }),
      ]),
    })['task.agent_retry'];

    await handler?.({ ...PAYLOAD, startAfterMs: Date.now() + 42_000 });

    // Still "1 of 3": the 429 counted, the wait for its cooldown does not.
    expect(kickAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ trigger: 'auto_retry', autoRetryAttempt: 1 }),
    );
  });

  it('queues the retry at once and hands the kick when a cooling broker has an account back', async () => {
    const handler = createTaskList({
      sql: sqlWith([failedRun('run-failed', 'credential_cooldown')]),
    })['task.agent_retry'];
    const startAfterMs = Date.now() + 42_000;

    await handler?.({ ...PAYLOAD, startAfterMs });

    expect(kickAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trigger: 'auto_retry',
        autoRetryAttempt: 1,
        startAfterMs,
      }),
    );
  });

  it('stops a grant that answers 401 on every vend, once free retries and budget are spent', async () => {
    const handler = createTaskList({
      sql: sqlWith(
        ['run-failed', 'run-5', 'run-4', 'run-3', 'run-2', 'run-1'].map((id) =>
          failedRun(id, 'credential_rotated'),
        ),
      ),
    })['task.agent_retry'];
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await handler?.(PAYLOAD);

    expect(kickAgentRun).not.toHaveBeenCalled();
  });
});
