import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  startTaskAgentTurnImpl,
  steerTaskAgentTurnImpl,
} from '../core/tasks/agent_run_host.ts';
import { releaseProjectAgentSessionSlot } from '../domains/sandbox/sessions.ts';
import { countParkedAgentRun } from '../domains/tasks/agent-run-counters.ts';
import { claimAgentWorker } from '../domains/tasks/agent-workers.ts';
import { createTaskList } from './task-list.ts';

vi.mock('../core/tasks/agent_run_host.ts', async (original) => ({
  ...(await original<typeof import('../core/tasks/agent_run_host.ts')>()),
  startTaskAgentTurnImpl: vi.fn(async () => null),
  steerTaskAgentTurnImpl: vi.fn(async () => null),
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
vi.mock('../domains/tasks/agent-run-counters.ts', async (original) => ({
  ...(await original<
    typeof import('../domains/tasks/agent-run-counters.ts')
  >()),
  countParkedAgentRun: vi.fn(async () => undefined),
}));

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  vi.mocked(startTaskAgentTurnImpl).mockClear();
  vi.mocked(releaseProjectAgentSessionSlot).mockClear();
  vi.mocked(claimAgentWorker).mockClear();
  vi.mocked(countParkedAgentRun).mockClear();
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
          engine: 'harness',
          handoff: null,
          ...run,
        },
      ]);
    if (query.includes('FROM app.project_agents'))
      return Promise.resolve([
        {
          instructions: null,
          skills: [],
          connectors: ['forgejo'],
          tools: [],
          secrets: [],
          connectorCredentials: { forgejo: 'Client A' },
          gitIdentity: { name: 'Coder', email: 'coder@tale.dev' },
        },
      ]);
    throw new Error('Unexpected start query');
  }) as unknown as Sql;
}

describe('a turn carries the agent’s pinned credentials and commit identity [SBX-R41]', () => {
  const STEER = {
    organizationId: 'org-1',
    runId: 'run-1',
    taskId: 'task-1',
    agentId: 'agent-1',
    execId: 'exec-1',
    sessionId: 'session-1',
    harness: 'codex',
    deadlineAt: Date.now() + 60_000,
    model: 'model',
    skills: [],
    connectors: ['forgejo'],
    tools: [],
    secrets: [],
    feedback: 'Push it.',
    author: 'Ada',
    authorId: 'ada',
    attempt: 0,
  };

  it('starts a run with the agent’s pins as stored', async () => {
    await createTaskList({ sql: turnSql() })['task.agent_turn']?.({
      organizationId: 'org-1',
      runId: 'run-1',
      execId: 'exec-1',
    });
    expect(startTaskAgentTurnImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        connectorCredentials: { forgejo: 'Client A' },
        gitIdentity: { name: 'Coder', email: 'coder@tale.dev' },
      }),
      undefined,
    );
  });

  it('reads the pins for a steer an older image queued without them, never leaving it on the default', async () => {
    vi.mocked(steerTaskAgentTurnImpl).mockClear();
    await createTaskList({ sql: turnSql() })['task.agent_steer']?.(STEER);
    expect(steerTaskAgentTurnImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        connectorCredentials: { forgejo: 'Client A' },
        gitIdentity: { name: 'Coder', email: 'coder@tale.dev' },
      }),
    );
  });

  it('keeps the pins a steer carries', async () => {
    vi.mocked(steerTaskAgentTurnImpl).mockClear();
    const sql = (() => {
      throw new Error('a steer carrying its pins reads nothing');
    }) as unknown as Sql;
    await createTaskList({ sql })['task.agent_steer']?.({
      ...STEER,
      connectorCredentials: {},
      gitIdentity: null,
    });
    expect(steerTaskAgentTurnImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ connectorCredentials: {}, gitIdentity: null }),
    );
  });
});

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

  it('counts the park its claim committed, under its waiting reason [TASK-R93]', async () => {
    const sql = turnSql();
    vi.mocked(claimAgentWorker).mockResolvedValue({ parked: 'org_limit' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await createTaskList({ sql })['task.agent_turn']?.(PAYLOAD);

    expect(countParkedAgentRun).toHaveBeenCalledExactlyOnceWith(
      sql,
      'org_limit',
    );
    warn.mockRestore();
  });

  it('counts no park for a run its claim started [TASK-R93]', async () => {
    await createTaskList({ sql: turnSql() })['task.agent_turn']?.(PAYLOAD);

    expect(startTaskAgentTurnImpl).toHaveBeenCalled();
    expect(countParkedAgentRun).not.toHaveBeenCalled();
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

describe('which engine a turn job serves', () => {
  const PAYLOAD = { organizationId: 'org-1', runId: 'run-1', execId: 'exec-1' };

  it('starts nothing for a native run that reached the harness queue', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await createTaskList({ sql: turnSql({ engine: 'native' }) })[
      'task.agent_turn'
    ]?.(PAYLOAD);

    expect(claimAgentWorker).not.toHaveBeenCalled();
    expect(startTaskAgentTurnImpl).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('is native'));
    warn.mockRestore();
  });

  it('hands the brief a native pass wrote to the harness it handed the run to [TASK-R31]', async () => {
    const handoff = { reason: 'needs a repository', brief: 'Clone and test.' };
    await createTaskList({ sql: turnSql({ handoff }) })['task.agent_turn']?.(
      PAYLOAD,
    );

    expect(startTaskAgentTurnImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ handoff }),
      undefined,
    );
  });
});
