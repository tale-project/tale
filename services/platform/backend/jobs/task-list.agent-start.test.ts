import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { startTaskAgentTurnImpl } from '../core/tasks/agent_run_host.ts';
import { releaseProjectAgentSessionSlot } from '../domains/sandbox/sessions.ts';
import { claimAgentWorker } from '../domains/tasks/agent-workers.ts';
import { createTaskList } from './task-list.ts';

vi.mock('../core/tasks/agent_run_host.ts', async (original) => ({
  ...(await original<typeof import('../core/tasks/agent_run_host.ts')>()),
  startTaskAgentTurnImpl: vi.fn(async () => null),
}));
vi.mock('../domains/tasks/kick-plan.ts', async (original) => ({
  ...(await original<typeof import('../domains/tasks/kick-plan.ts')>()),
  resolveTaskKickStartArgs: async () => ({ sweep: true }),
}));
vi.mock('../domains/tasks/agent-workers.ts', async (original) => ({
  ...(await original<typeof import('../domains/tasks/agent-workers.ts')>()),
  claimAgentWorker: vi.fn(),
}));
vi.mock('../domains/sandbox/sessions.ts', async (original) => ({
  ...(await original<typeof import('../domains/sandbox/sessions.ts')>()),
  releaseProjectAgentSessionSlot: vi.fn(async () => true),
}));

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  vi.mocked(startTaskAgentTurnImpl).mockClear();
  vi.mocked(releaseProjectAgentSessionSlot).mockClear();
  vi.mocked(claimAgentWorker).mockResolvedValue({
    sessionId: 'session-1',
    worker: 1,
    moved: false,
  });
});

/** The turn job's reads: the queued run (with `run` over its defaults) and
 * its agent. */
function turnSql(run: Record<string, unknown> = {}): Sql {
  return ((parts: TemplateStringsArray) => {
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
          startedAt: Date.now(),
          launchedAt: null,
          status: 'queued',
          execId: 'exec-1',
          startedVia: null,
          viaAutomation: null,
          viaAgentName: null,
          projectId: 'project-1',
          startedBy: 'user:starter',
          ...run,
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
}

it('hands the admitted queued start its existing job cancellation signal', async () => {
  const sql = turnSql();
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

describe('the worker a turn starts in', () => {
  const PAYLOAD = { organizationId: 'org-1', runId: 'run-1', execId: 'exec-1' };

  it('starts the run in the worker its claim chose [TASK-R24]', async () => {
    vi.mocked(claimAgentWorker).mockResolvedValue({
      sessionId: 'pa-agent-1-w2',
      worker: 2,
      moved: true,
    });
    await createTaskList({ sql: turnSql() })['task.agent_turn']?.(PAYLOAD);

    expect(claimAgentWorker).toHaveBeenCalledWith(expect.anything(), PAYLOAD);
    expect(startTaskAgentTurnImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'pa-agent-1-w2' }),
      undefined,
    );
    // The worker the run named before may hold nothing now.
    expect(releaseProjectAgentSessionSlot).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org-1', agentId: 'agent-1' },
    );
  });

  it('starts nothing for a run its claim parked [TASK-R25]', async () => {
    vi.mocked(claimAgentWorker).mockResolvedValue({ parked: 'org_limit' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await createTaskList({ sql: turnSql() })['task.agent_turn']?.(PAYLOAD);

    expect(startTaskAgentTurnImpl).not.toHaveBeenCalled();
    expect(releaseProjectAgentSessionSlot).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('gives a run that waited its full working time [TASK-R25]', async () => {
    const kickedAt = Date.now() - 10 * HOUR;
    await createTaskList({
      sql: turnSql({ startedAt: kickedAt, deadlineAt: kickedAt + 12 * HOUR }),
    })['task.agent_turn']?.(PAYLOAD);

    const deadline = vi.mocked(startTaskAgentTurnImpl).mock.calls[0]?.[1]
      .deadlineAt;
    expect(deadline).toBeGreaterThanOrEqual(Date.now() + 12 * HOUR - 60_000);
  });
});
