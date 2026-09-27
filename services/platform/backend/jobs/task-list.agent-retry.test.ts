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

import { createTaskList } from './task-list.ts';

const PAYLOAD = {
  organizationId: 'org-1',
  taskId: 'task-1',
  agentId: 'agent-1',
  expectedRunId: 'run-failed',
};

/** A transaction that answers the job's three reads: the task, its runs
 * newest first, and the agent. */
function sqlWith(runs: Array<Record<string, unknown>>): Sql {
  const tx = (strings: TemplateStringsArray) => {
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

describe('task.agent_retry', () => {
  beforeEach(() => vi.clearAllMocks());

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
});
