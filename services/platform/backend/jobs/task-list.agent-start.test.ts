import type { Sql } from 'postgres';
import { expect, it, vi } from 'vitest';

import { startTaskAgentTurnImpl } from '../core/tasks/agent_run_host.ts';
import { createTaskList } from './task-list.ts';

vi.mock('../core/tasks/agent_run_host.ts', async (original) => ({
  ...(await original<typeof import('../core/tasks/agent_run_host.ts')>()),
  startTaskAgentTurnImpl: vi.fn(async () => null),
}));
vi.mock('../domains/tasks/kick-plan.ts', async (original) => ({
  ...(await original<typeof import('../domains/tasks/kick-plan.ts')>()),
  resolveTaskKickStartArgs: async () => ({ sweep: true }),
}));

it('hands the admitted queued start its existing job cancellation signal', async () => {
  const sql = ((parts: TemplateStringsArray) => {
    const query = parts.join('?');
    if (query.includes('FROM app.project_agent_runs'))
      return Promise.resolve([
        {
          taskId: 'task-1',
          agentId: 'agent-1',
          sessionId: 'session-1',
          harness: 'claude-code',
          model: 'model',
          modelProvider: 'provider',
          feedback: null,
          mentionSource: null,
          deadlineAt: Date.now() + 60_000,
          status: 'queued',
          execId: 'exec-1',
          startedVia: null,
          viaAutomation: null,
          viaAgentName: null,
          projectId: 'project-1',
          startedBy: 'user:starter',
        },
      ]);
    if (query.includes('FROM app.project_agents'))
      return Promise.resolve([
        {
          instructions: null,
          skills: [],
          connectors: [],
          tools: [],
          secrets: [],
        },
      ]);
    throw new Error('Unexpected start query');
  }) as unknown as Sql;
  const controller = new AbortController();
  const handler = createTaskList({ sql })['task.agent_turn'];
  expect(handler).toBeDefined();
  await handler?.(
    { organizationId: 'org-1', runId: 'run-1', execId: 'exec-1' },
    { signal: controller.signal },
  );
  expect(startTaskAgentTurnImpl).toHaveBeenCalledTimes(1);
  expect(startTaskAgentTurnImpl).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      runId: 'run-1',
      execId: 'exec-1',
      sessionId: 'session-1',
    }),
    { signal: controller.signal },
  );
  controller.abort();
  expect(
    vi.mocked(startTaskAgentTurnImpl).mock.calls[0]?.[2]?.signal?.aborted,
  ).toBe(true);
});
