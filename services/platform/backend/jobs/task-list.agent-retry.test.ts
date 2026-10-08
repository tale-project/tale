/**
 * An auto-retry continues its failed run's kick, so it acts for the same
 * person: the retry run's `started_by` is the failed run's, never the
 * agent's creator, the task's creator or a system marker. Spend attribution
 * and the member a task run's connector calls act for both read that column,
 * so a retry that switched it would book and act for someone who did not
 * start the work. And it starts new work only where that person's manual
 * Start would, as the project and their access stand when it runs.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { kickAgentRun, startedViaOfRun } = vi.hoisted(() => ({
  kickAgentRun: vi.fn(async () => ({ runId: 'run-retry' })),
  startedViaOfRun: vi.fn(
    async (): Promise<Record<string, string> | undefined> => undefined,
  ),
}));

vi.mock('../domains/tasks/agent-runs.ts', async () => {
  const errors = await import('../domains/tasks/errors.ts');
  return {
    kickAgentRun,
    startedViaOfRun,
    isStandardAgentRefusal: (error: unknown) =>
      error instanceof errors.TaskError &&
      (error.code === 'STANDARD_AGENT_OFF' ||
        error.code === 'STANDARD_AGENT_UNAVAILABLE'),
  };
});
vi.mock('./enqueue.ts', () => ({ addJobInTx: vi.fn() }));

// What a final refusal means to people is the notice module's; these tests
// pin WHEN the job ends a failed run's retry for good, and whether it tells.
const { announceAgentRunFailed, retireAutoRetry } = vi.hoisted(() => ({
  announceAgentRunFailed: vi.fn(async () => {}),
  retireAutoRetry: vi.fn(async () => {}),
}));
vi.mock('../domains/tasks/run-failure-notice.ts', () => ({
  announceAgentRunFailed,
  retireAutoRetry,
}));

/** The retirement of the failed run's retry, as the job asks for it. */
function retiredWith(announce: boolean) {
  return [
    expect.anything(),
    {
      organizationId: 'org-1',
      taskId: 'task-1',
      runId: 'run-failed',
      announce,
    },
  ];
}

import { memberSessionIdForProjectAgent } from '../core/sandbox/session_naming.ts';
import {
  AGENT_BUSY_RETRY_DELAY_MS,
  AGENT_BUSY_RETRY_MAX_WAIT_MS,
  AGENT_BUSY_RETRY_MAX_WAITS,
  AUTO_RETRY_HISTORY_LIMIT,
  AUTO_RETRY_MAX_ATTEMPTS,
} from '../core/tasks/task_auto_retry.ts';
import { TaskError } from '../domains/tasks/errors.ts';
import { addJobInTx } from './enqueue.ts';
import { agentRetryRecheckKey, createTaskList } from './task-list.ts';
import { TASK_QUEUE_OPTIONS } from './tasks.ts';

const PAYLOAD = {
  organizationId: 'org-1',
  taskId: 'task-1',
  agentId: 'agent-1',
  expectedRunId: 'run-failed',
};

/** What the job asked the run history for: the query text and its values. */
const reads: Array<{ text: string; values: unknown[] }> = [];
/** Every statement the job ran, in order. */
const statements: string[] = [];

interface World {
  /** The task's project as it stands; `null` when it is gone. */
  project?: { archivedAt: number | null; teamIds: string[] } | null;
  /** The starter's membership; `null` when they are no longer a member. */
  member?: { role: string } | null;
  /** The starter's teams in the organization. */
  teams?: string[];
  /** Who created the task (default: someone other than the starter). */
  createdBy?: string;
  /** Whether the schedule a `trigger:` starter names may still act in the
   * project — enabled, its automation bound there (default: it may). */
  schedule?: boolean;
  /** When the task's automated starts of the last hour began, as the
   * per-task budget reads them (default: none). */
  automatedStarts?: number[];
  /** The card's column (default: in_progress). */
  status?: string;
  archived?: boolean;
  /** Monotonic decision cursor, returned as text without numeric rounding. */
  activityId?: string;
  /** Who holds the card (default: the retried agent). */
  assigneeId?: string;
  /** The agent's live run on another task in the workspace the retry
   * looks at (default: none — the workspace is free). */
  busy?: { id: string; taskId: string };
  /** The agent row is gone (default: it is there). */
  agentGone?: boolean;
  /** An earlier delivery already retired this failed run's retry: the
   * retirement's election updates nothing. */
  refusedAlready?: boolean;
}

/** The busy probe's statements with their values, in order. */
const probes: Array<{ text: string; values: unknown[] }> = [];

/** A transaction that answers the job's reads: the task, its runs newest
 * first, the agent, and the admission's project, member and team reads. */
function sqlWith(runs: Array<Record<string, unknown>>, world: World = {}): Sql {
  const project =
    world.project === undefined
      ? { archivedAt: null, teamIds: [] }
      : world.project;
  const member = world.member === undefined ? { role: 'editor' } : world.member;
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push(text);
    if (text.includes('FROM app.tasks')) {
      return Promise.resolve([
        {
          status: world.status ?? 'in_progress',
          archivedAt: world.archived === true ? 1 : null,
          activityId: world.activityId ?? '41',
          projectId: 'project-1',
          assigneeType: 'agent',
          assigneeId: world.assigneeId ?? 'agent-1',
          createdBy: world.createdBy ?? 'user-creator',
          createdByType: 'user',
          parentTaskId: null,
        },
      ]);
    }
    if (
      text.includes('FROM app.project_agent_runs') &&
      text.includes('started_via IS NOT NULL')
    ) {
      return Promise.resolve(
        (world.automatedStarts ?? []).map((startedAt) => ({
          startedAt,
          automated: true,
          agentId: 'agent-1',
          status: 'failed',
          failureCode: 'turn_crashed',
          apiErrorStatus: null,
        })),
      );
    }
    if (
      text.includes('FROM app.project_agent_runs') &&
      text.includes('session_id')
    ) {
      probes.push({ text, values });
      return Promise.resolve(world.busy === undefined ? [] : [world.busy]);
    }
    if (text.includes('FROM app.project_agent_runs')) {
      reads.push({ text, values });
      return Promise.resolve(runs);
    }
    if (
      text.includes('INSERT INTO app.task_activity') ||
      text.includes('INSERT INTO app_realtime.outbox')
    ) {
      return Promise.resolve([]);
    }
    if (text.includes('UPDATE app.project_agent_runs')) {
      return Promise.resolve(
        world.refusedAlready === true ? [] : [{ id: 'run-failed' }],
      );
    }
    if (text.includes('UPDATE app.project_agents')) {
      return Promise.resolve(
        world.agentGone === true
          ? []
          : [
              {
                id: 'agent-1',
                projectId: 'project-1',
                harness: 'claude-code',
                model: 'm',
                modelProvider: null,
              },
            ],
      );
    }
    if (text.includes('FROM app.project_agents')) {
      return Promise.resolve(
        world.agentGone === true
          ? []
          : [{ harness: 'claude-code', model: 'm', modelProvider: null }],
      );
    }
    if (text.includes('FROM app.projects')) {
      if (project === null) return Promise.resolve([]);
      return Promise.resolve([
        {
          id: 'project-1',
          organizationId: 'org-1',
          archivedAt: project.archivedAt,
          teamIds: project.teamIds,
          teamId: project.teamIds[0] ?? null,
          sharedWithTeamIds: project.teamIds.slice(1),
        },
      ]);
    }
    if (text.includes('FROM "member"')) {
      return Promise.resolve(
        member === null
          ? []
          : [
              {
                id: 'member-1',
                organizationId: 'org-1',
                userId: values[1],
                role: member.role,
              },
            ],
      );
    }
    if (text.includes('FROM "teamMember"')) {
      return Promise.resolve((world.teams ?? []).map((teamId) => ({ teamId })));
    }
    // A starter who is no member is no API key's own identity either.
    if (text.includes('FROM app.api_key_owners')) return Promise.resolve([]);
    if (text.includes('FROM app.automation_triggers')) {
      return Promise.resolve(
        world.schedule === false ? [] : [{ id: 'schedule-1' }],
      );
    }
    throw new Error(`unexpected query: ${text}`);
  };
  const unsafe = (text: string) => text;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- postgres.js as far as the retry job uses it
  return {
    begin: async (run: (t: typeof tx) => Promise<unknown>) =>
      run(Object.assign(tx, { unsafe })),
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
    statements.length = 0;
    probes.length = 0;
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

  it('carries the API key the failed run was started with, and none it lacked [SBX-R14]', async () => {
    for (const apiKeyId of ['key-1', null]) {
      const handler = createTaskList({
        sql: sqlWith([
          {
            id: 'run-failed',
            status: 'failed',
            agentId: 'agent-1',
            startedBy: 'api-key:user-starter',
            apiKeyId,
            launchedAt: 1_000,
            settledAt: 2_000,
          },
        ]),
      })['task.agent_retry'];
      await handler?.(PAYLOAD);
    }

    expect(kickAgentRun).toHaveBeenCalledTimes(2);
    expect(kickAgentRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ apiKeyId: 'key-1', trigger: 'auto_retry' }),
    );
    expect(kickAgentRun).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.not.objectContaining({ apiKeyId: expect.anything() }),
    );
  });

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
    // The budget is spent: nothing starts the task again, so it is said.
    expect(retireAutoRetry).toHaveBeenCalledWith(...retiredWith(true));
  });
});

describe('task.agent_retry admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.length = 0;
    statements.length = 0;
    probes.length = 0;
  });

  async function deliver(
    world: World,
    startedBy = 'user-starter',
    run: Record<string, unknown> = {},
  ): Promise<string[]> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handler = createTaskList({
      sql: sqlWith(
        [failedRun('run-failed', 'turn_crashed', { startedBy, ...run })],
        world,
      ),
    })['task.agent_retry'];
    await handler?.(PAYLOAD);
    const lines = log.mock.calls.map((call) => String(call[0]));
    log.mockRestore();
    return lines;
  }

  it('share-locks the project and checks it before it kicks', async () => {
    const lines = await deliver({});

    expect(kickAgentRun).toHaveBeenCalledTimes(1);
    expect(lines).toEqual([]);
    const lock = statements.findIndex(
      (text) =>
        text.includes('FROM app.projects') && text.includes('FOR SHARE'),
    );
    expect(lock).toBeGreaterThan(-1);
    expect(statements[lock]).toContain('org_id');
  });

  it.each([
    [
      'a project archived since the run failed',
      { project: { archivedAt: 1_700_000_000_000, teamIds: [] } },
      'project_archived',
    ],
    ['a project that is gone', { project: null }, 'project_unavailable'],
    ['a starter who left the organization', { member: null }, 'not_permitted'],
    [
      'a starter who may no longer edit',
      { member: { role: 'member' } },
      'not_permitted',
    ],
    ['a disabled starter', { member: { role: 'disabled' } }, 'not_permitted'],
    [
      'a starter outside the team the project belongs to',
      { project: { archivedAt: null, teamIds: ['team-a'] }, teams: ['team-b'] },
      'not_permitted',
    ],
  ] satisfies [string, World, string][])(
    'starts nothing for %s',
    async (_label, world, reason) => {
      const lines = await deliver(world);

      expect(kickAgentRun).not.toHaveBeenCalled();
      expect(lines).toEqual([`[task-agent] auto-retry skipped: ${reason}`]);
      // This delivery completes without another check; every final refusal
      // retires the marker. Human archive decisions need no failure notice.
      expect(retireAutoRetry).toHaveBeenCalledWith(
        ...retiredWith(reason === 'not_permitted'),
      );
    },
  );

  it.each(['STANDARD_AGENT_OFF', 'STANDARD_AGENT_UNAVAILABLE'])(
    'retires the failed run once, and tells, when the standard agent refuses its retry (%s)',
    async (code) => {
      kickAgentRun.mockRejectedValueOnce(
        new TaskError(code, 'The standard agent cannot run', 409),
      );
      const handler = createTaskList({
        sql: sqlWith([failedRun('run-failed', 'harness_error')]),
      })['task.agent_retry'];

      await handler?.(PAYLOAD);

      expect(kickAgentRun).toHaveBeenCalledTimes(1);
      expect(retireAutoRetry).toHaveBeenCalledWith(...retiredWith(true));
    },
  );

  it('retires an explicitly disabled task policy without reviving it on later delivery', async () => {
    kickAgentRun.mockRejectedValueOnce(
      new TaskError(
        'TASK_AUTOMATION_DISABLED',
        'disabled by an administrator',
        403,
      ),
    );
    const lines = await deliver({});
    expect(lines).toEqual([
      '[task-agent] auto-retry skipped: task_automation_disabled',
    ]);
    expect(retireAutoRetry).toHaveBeenCalledWith(...retiredWith(false));
  });

  it('lets any other kick refusal fail the delivery, so the queue retries it', async () => {
    kickAgentRun.mockRejectedValueOnce(
      new TaskError('TASK_AUTOMATION_UNAVAILABLE', 'unreadable', 409),
    );
    const handler = createTaskList({
      sql: sqlWith([failedRun('run-failed', 'harness_error')]),
    })['task.agent_retry'];

    await expect(handler?.(PAYLOAD)).rejects.toMatchObject({
      code: 'TASK_AUTOMATION_UNAVAILABLE',
    });
    expect(retireAutoRetry).not.toHaveBeenCalled();
  });

  it('retries a member on a task of their own, which they may still work', async () => {
    await deliver({ member: { role: 'member' }, createdBy: 'user-starter' });

    expect(kickAgentRun).toHaveBeenCalledTimes(1);
    expect(retireAutoRetry).not.toHaveBeenCalled();
    expect(announceAgentRunFailed).not.toHaveBeenCalled();
  });

  it('retries a team member of a team project', async () => {
    await deliver({
      project: { archivedAt: null, teamIds: ['team-a'] },
      teams: ['team-a'],
    });

    expect(kickAgentRun).toHaveBeenCalledTimes(1);
  });

  it('retries a run a schedule began while that schedule may act in the project', async () => {
    const archived = await deliver(
      { project: { archivedAt: 1_700_000_000_000, teamIds: [] }, member: null },
      'trigger:schedule-1',
    );
    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(archived).toEqual([
      '[task-agent] auto-retry skipped: project_archived',
    ]);

    await deliver({ member: null }, 'trigger:schedule-1');
    expect(kickAgentRun).toHaveBeenCalledTimes(1);
    const probe = statements.find((text) =>
      text.includes('FROM app.automation_triggers'),
    );
    expect(probe).toContain("t.kind = 'schedule'");
    expect(probe).toContain('t.enabled = true');
    expect(probe).toContain('app.automation_project_bindings');
  });

  it('starts nothing for a run whose schedule was paused, removed or unbound since', async () => {
    const lines = await deliver({ schedule: false }, 'trigger:schedule-1');

    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(lines).toEqual(['[task-agent] auto-retry skipped: not_permitted']);
  });

  it('keeps the lane of a run an automation step or another agent started', async () => {
    const via = { kind: 'agent', runId: 'run-manager', agentId: 'agent-9' };
    startedViaOfRun.mockResolvedValueOnce(via);

    await deliver({});

    expect(startedViaOfRun).toHaveBeenCalledWith(
      expect.anything(),
      'run-failed',
    );
    expect(kickAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ trigger: 'auto_retry', startedVia: via }),
    );
  });

  it('counts an automated run’s retry against the per-task budget, and kicks it while the hour has room', async () => {
    startedViaOfRun.mockResolvedValueOnce({
      kind: 'agent',
      runId: 'run-manager',
      agentId: 'agent-9',
    });
    const now = Date.now();

    await deliver({ automatedStarts: [now - 30_000, now - 20_000] });

    const budget = statements.find((text) =>
      text.includes('started_via IS NOT NULL'),
    );
    expect(budget).toContain('FROM app.project_agent_runs');
    expect(budget).not.toContain('trigger');
    expect(kickAgentRun).toHaveBeenCalledTimes(1);
    expect(
      statements.some((text) => text.includes('INSERT INTO app.task_activity')),
    ).toBe(false);
  });

  it('refuses an automated run’s retry once the hour holds three automated starts, retries included, and records why', async () => {
    startedViaOfRun.mockResolvedValueOnce({
      kind: 'automation',
      runId: 'run-occurrence',
      nodeId: 'start',
      automation: 'autonomous-cycle/fleet-manager',
    });
    const now = Date.now();

    const lines = await deliver({
      automatedStarts: [now - 50_000, now - 40_000, now - 30_000],
    });

    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(lines).toEqual([
      '[task-agent] auto-retry skipped: task_circuit_breaker',
    ]);
    expect(retireAutoRetry).toHaveBeenCalledWith(...retiredWith(true));
    const refusal = statements.find((text) =>
      text.includes('INSERT INTO app.task_activity'),
    );
    expect(refusal).toBeDefined();
  });

  it('never counts or refuses the retry of a run a person started', async () => {
    const now = Date.now();

    const lines = await deliver({
      automatedStarts: [now - 50_000, now - 40_000, now - 30_000],
    });

    expect(kickAgentRun).toHaveBeenCalledTimes(1);
    expect(lines).toEqual([]);
    expect(
      statements.some((text) => text.includes('started_via IS NOT NULL')),
    ).toBe(false);
  });

  it.each(['backlog', 'todo', 'in_progress'])(
    'retries an unchanged in-place %s card without moving it',
    async (status) => {
      const via = {
        kind: 'automation',
        runId: 'run-occurrence',
        nodeId: 'start',
        automation: 'autonomous-cycle/local-qa',
      };
      startedViaOfRun.mockResolvedValueOnce(via);
      const lines = await deliver({ status }, 'user-starter', {
        inPlace: true,
        inPlaceRetryStatus: status,
        inPlaceRetryActivityId: '41',
      });

      expect(lines).toEqual([]);
      expect(kickAgentRun).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ startedVia: via, inPlace: true }),
      );
      expect(retireAutoRetry).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a move to another column', { status: 'in_progress' }, 'todo', '41'],
    [
      'a move away and back',
      { status: 'todo', activityId: '43' },
      'todo',
      '41',
    ],
    [
      'a bigint decision beyond exact JS numbers',
      { status: 'todo', activityId: '9007199254740993' },
      'todo',
      '9007199254740992',
    ],
    ['a legacy run without a snapshot', { status: 'todo' }, null, null],
    ['a closed original state', { status: 'done' }, 'done', '41'],
  ] satisfies [string, World, string | null, string | null][])(
    'retires in-place retries after %s',
    async (_label, world, status, activityId) => {
      startedViaOfRun.mockResolvedValueOnce({
        kind: 'agent',
        runId: 'manager-run',
        agentId: 'manager',
      });
      const lines = await deliver(world, 'user-starter', {
        inPlace: true,
        inPlaceRetryStatus: status,
        inPlaceRetryActivityId: activityId,
      });
      expect(lines).toEqual(['[task-agent] auto-retry skipped: task_moved']);
      expect(kickAgentRun).not.toHaveBeenCalled();
      expect(retireAutoRetry).toHaveBeenCalledWith(...retiredWith(false));
      expect(addJobInTx).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['task_moved', { status: 'todo' }],
    ['reassigned', { assigneeId: 'agent-2' }],
    ['task_unavailable', { archived: true }],
  ] satisfies [string, World][])(
    'retires a final %s decision so retryPending cannot remain armed',
    async (reason, world) => {
      const lines = await deliver(world);
      expect(lines).toEqual([`[task-agent] auto-retry skipped: ${reason}`]);
      expect(retireAutoRetry).toHaveBeenCalledWith(...retiredWith(false));
      expect(kickAgentRun).not.toHaveBeenCalled();
    },
  );

  it('refuses a starter that names nobody', async () => {
    const lines = await deliver({}, 'itest:plan');

    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(lines).toEqual(['[task-agent] auto-retry skipped: not_permitted']);
  });

  it('checks a REST start against the person behind the key', async () => {
    const lines = await deliver(
      { member: { role: 'member' } },
      'api-key:user-starter',
    );

    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(lines).toEqual(['[task-agent] auto-retry skipped: not_permitted']);
  });
});

describe('task.agent_retry — an automated chain waits for its busy agent', () => {
  const via = { kind: 'agent', runId: 'run-manager', agentId: 'agent-9' };
  const elsewhere = { id: 'run-other', taskId: 'task-other' };

  beforeEach(() => {
    vi.clearAllMocks();
    reads.length = 0;
    statements.length = 0;
    probes.length = 0;
  });

  /** A failed attempt that ended `ago` ms before now. */
  function failedAgo(ago: number, startedBy = 'user-starter') {
    const settledAt = Date.now() - ago;
    return failedRun('run-failed', 'turn_crashed', {
      startedBy,
      launchedAt: settledAt - 1_000,
      settledAt,
    });
  }

  async function deliver(
    world: World,
    options: {
      automated?: boolean;
      payload?: Record<string, unknown>;
      run?: Record<string, unknown>;
    } = {},
  ): Promise<string[]> {
    if (options.automated !== false) startedViaOfRun.mockResolvedValueOnce(via);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handler = createTaskList({
      sql: sqlWith([options.run ?? failedAgo(1_000)], world),
    })['task.agent_retry'];
    await handler?.(options.payload ?? PAYLOAD);
    const lines = log.mock.calls.map((call) => String(call[0]));
    log.mockRestore();
    return lines;
  }

  const lockIndex = () =>
    statements.findIndex((text) => text.includes('UPDATE app.project_agents'));
  const taskLockIndex = () =>
    statements.findIndex(
      (text) => text.includes('FROM app.tasks') && text.includes('FOR UPDATE'),
    );

  it('takes the agent row before the task row, and starts into the workspace it found free', async () => {
    const lines = await deliver({});

    expect(lines).toEqual([]);
    expect(lockIndex()).toBeGreaterThan(-1);
    expect(taskLockIndex()).toBeGreaterThan(lockIndex());
    // The lock is a write, as the delegated start's: it invalidates an
    // overlapping serializable snapshot.
    expect(statements[lockIndex()]).toContain('updated_at_ms = updated_at_ms');
    expect(statements[lockIndex()]).toContain('org_id');
    expect(
      statements.filter((text) => text.includes('UPDATE app.project_agents')),
    ).toHaveLength(1);
    expect(probes).toHaveLength(1);
    expect(probes[0]?.values).toEqual(
      expect.arrayContaining(['org-1', 'agent-1', 'pa-agent-1', 'task-1']),
    );
    expect(probes[0]?.text).toContain("status IN ('queued', 'running')");
    expect(kickAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trigger: 'auto_retry',
        startedVia: via,
        sessionId: 'pa-agent-1',
      }),
    );
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('leaves the retry of a person’s run as it was — no agent lock, no look at the workspace', async () => {
    const lines = await deliver({ busy: elsewhere }, { automated: false });

    expect(lines).toEqual([]);
    expect(lockIndex()).toBe(-1);
    expect(probes).toHaveLength(0);
    expect(kickAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ sessionId: expect.anything() }),
    );
  });

  it('waits while the agent works another task there: nothing started, refused or counted — a later check of the retry is queued', async () => {
    const before = Date.now();
    const lines = await deliver({ busy: elsewhere });
    const after = Date.now();

    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(addJobInTx).toHaveBeenCalledTimes(1);
    const [, name, next, options] = vi.mocked(addJobInTx).mock.calls[0] ?? [];
    expect(name).toBe('task.agent_retry_recheck');
    expect(next).toEqual({ ...PAYLOAD, agentBusyWaits: 1 });
    const { startAfter, singletonKey } =
      (options as { startAfter?: Date; singletonKey?: string } | undefined) ??
      {};
    expect(singletonKey).toBe('agent-retry:org-1:task-1:run-failed');
    expect(startAfter?.getTime()).toBeGreaterThanOrEqual(
      before + AGENT_BUSY_RETRY_DELAY_MS,
    );
    expect(startAfter?.getTime()).toBeLessThanOrEqual(
      after + AGENT_BUSY_RETRY_DELAY_MS,
    );
    // Never at once: a busy agent is no hot loop.
    expect(AGENT_BUSY_RETRY_DELAY_MS).toBeGreaterThanOrEqual(60_000);
    expect(
      statements.some((text) => text.includes('INSERT INTO app.task_activity')),
    ).toBe(false);
    // Judged before the hourly budget, which it neither reads nor spends.
    expect(
      statements.some((text) => text.includes('started_via IS NOT NULL')),
    ).toBe(false);
    expect(lines).toEqual([
      `[task-agent] auto-retry waiting: agent_busy (check 1 of ${AGENT_BUSY_RETRY_MAX_WAITS} queued: run run-other on task task-other)`,
    ]);
  });

  it('keeps at most one check queued per failed run: every check, from the arm or from a check, carries its key on a short queue of its own', async () => {
    await deliver({ busy: elsewhere });
    await deliver(
      { busy: elsewhere },
      { payload: { ...PAYLOAD, agentBusyWaits: 5 } },
    );

    const keys = vi
      .mocked(addJobInTx)
      .mock.calls.map(
        ([, name, , options]) =>
          `${name}|${(options as { singletonKey?: string } | undefined)?.singletonKey}`,
      );
    expect(keys).toEqual([
      'task.agent_retry_recheck|agent-retry:org-1:task-1:run-failed',
      'task.agent_retry_recheck|agent-retry:org-1:task-1:run-failed',
    ]);
    expect(agentRetryRecheckKey(PAYLOAD)).toBe(
      'agent-retry:org-1:task-1:run-failed',
    );
    // `short`: one QUEUED job per key, so a second send is dropped while the
    // first waits (the documented queue contract, `TaskQueueOptions`). The
    // arm's queue keeps its standard policy: the previous image's arms are
    // keyless and would shut each other out there.
    expect(TASK_QUEUE_OPTIONS['task.agent_retry_recheck']).toEqual({
      policy: 'short',
      retryLimit: 1,
      expireInSeconds: 600,
    });
    expect(TASK_QUEUE_OPTIONS['task.agent_retry'].policy).toBeUndefined();
  });

  it('says so when the one check of its failed run is already queued', async () => {
    vi.mocked(addJobInTx).mockResolvedValueOnce(null);

    const lines = await deliver({ busy: elsewhere });

    expect(lines).toEqual([
      '[task-agent] auto-retry waiting: agent_busy (a check is already queued: run run-other on task task-other)',
    ]);
    expect(kickAgentRun).not.toHaveBeenCalled();
  });

  it('runs the arm and every check through one worker', () => {
    const tasks = createTaskList({ sql: sqlWith([]) });

    expect(tasks['task.agent_retry_recheck']).toBeDefined();
    expect(tasks['task.agent_retry_recheck']).toBe(tasks['task.agent_retry']);
  });

  it('carries the broker cooldown and counts its checks', async () => {
    const startAfterMs = Date.now() + 42_000;

    await deliver(
      { busy: elsewhere },
      { payload: { ...PAYLOAD, startAfterMs, agentBusyWaits: 3 } },
    );

    expect(vi.mocked(addJobInTx).mock.calls[0]?.[2]).toEqual({
      ...PAYLOAD,
      startAfterMs,
      agentBusyWaits: 4,
    });
  });

  it('looks in the workspace the retry would join — a confined retry in the member’s own — and starts there', async () => {
    const own = memberSessionIdForProjectAgent('agent-1', 'user-starter');

    await deliver({ member: { role: 'member' }, createdBy: 'user-starter' });

    expect(probes[0]?.values).toContain(own);
    expect(probes[0]?.values).not.toContain('pa-agent-1');
    expect(kickAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: own }),
    );

    vi.clearAllMocks();
    probes.length = 0;
    await deliver({
      member: { role: 'member' },
      createdBy: 'user-starter',
      busy: elsewhere,
    });
    expect(probes[0]?.values).toContain(own);
    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(addJobInTx).toHaveBeenCalledTimes(1);
  });

  it('gives up after its last check: retired on its failed run and refused once on the timeline, as the agent, with nothing sent or started', async () => {
    const lines = await deliver(
      { busy: elsewhere },
      { payload: { ...PAYLOAD, agentBusyWaits: AGENT_BUSY_RETRY_MAX_WAITS } },
    );

    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
    const retire = statements.findIndex((text) =>
      text.includes('UPDATE app.project_agent_runs'),
    );
    const refusal = statements.findIndex((text) =>
      text.includes('INSERT INTO app.task_activity'),
    );
    expect(retire).toBeGreaterThan(-1);
    expect(statements[retire]).toContain('auto_retry_refused_at_ms IS NULL');
    expect(statements[retire]).toContain("status = 'failed'");
    expect(refusal).toBeGreaterThan(retire);
    expect(lines).toEqual(['[task-agent] auto-retry skipped: agent_busy']);
    expect(announceAgentRunFailed).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      runId: 'run-failed',
    });
  });

  it('gives up once a look would fall past the longest wait after the failure', async () => {
    await deliver(
      { busy: elsewhere },
      { run: failedAgo(AGENT_BUSY_RETRY_MAX_WAIT_MS - 60_000) },
    );
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(
      statements.some((text) => text.includes('INSERT INTO app.task_activity')),
    ).toBe(true);

    vi.clearAllMocks();
    statements.length = 0;
    await deliver(
      { busy: elsewhere },
      {
        run: failedAgo(
          AGENT_BUSY_RETRY_MAX_WAIT_MS - AGENT_BUSY_RETRY_DELAY_MS - 60_000,
        ),
      },
    );
    expect(addJobInTx).toHaveBeenCalledTimes(1);
  });

  it('records the refusal once: only the delivery that retires the failed run writes the timeline row', async () => {
    const lines = await deliver(
      { busy: elsewhere, refusedAlready: true },
      { payload: { ...PAYLOAD, agentBusyWaits: AGENT_BUSY_RETRY_MAX_WAITS } },
    );

    expect(
      statements.some((text) => text.includes('UPDATE app.project_agent_runs')),
    ).toBe(true);
    expect(
      statements.some((text) => text.includes('INSERT INTO app.task_activity')),
    ).toBe(false);
    expect(lines).toEqual(['[task-agent] auto-retry skipped: agent_busy']);
    // Told once, by the delivery that retired it.
    expect(announceAgentRunFailed).not.toHaveBeenCalled();
  });

  it.each([
    ['the arm, the agent still busy', { busy: elsewhere }, PAYLOAD],
    ['the arm, the agent free by now', {}, PAYLOAD],
    [
      'a check queued before the refusal, the agent free',
      {},
      { ...PAYLOAD, agentBusyWaits: 7 },
    ],
    [
      'the very check that refused, delivered again once the agent is free',
      {},
      { ...PAYLOAD, agentBusyWaits: AGENT_BUSY_RETRY_MAX_WAITS },
    ],
  ] satisfies [string, World, Record<string, unknown>][])(
    'stands down on a retry refused for good — %s — and starts, queues and records nothing',
    async (_label, world, payload) => {
      const lines = await deliver(world, {
        payload,
        run: {
          ...failedAgo(3 * 60 * 60 * 1000),
          autoRetryRefusedAt: Date.now() - 60_000,
        },
      });

      expect(lines).toEqual(['[task-agent] auto-retry skipped: retry_refused']);
      expect(kickAgentRun).not.toHaveBeenCalled();
      expect(addJobInTx).not.toHaveBeenCalled();
      expect(probes).toHaveLength(0);
      expect(
        statements.some(
          (text) =>
            text.includes('UPDATE app.project_agent_runs') ||
            text.includes('INSERT INTO app.task_activity'),
        ),
      ).toBe(false);
    },
  );

  it('lets a newer run retry: the mark of an older refused run never holds it', async () => {
    const handler = createTaskList({
      sql: sqlWith([
        failedAgo(1_000),
        {
          ...failedRun('run-older', 'turn_crashed'),
          autoRetryRefusedAt: Date.now() - 60_000,
        },
      ]),
    })['task.agent_retry'];
    startedViaOfRun.mockResolvedValueOnce(via);

    await handler?.(PAYLOAD);

    expect(kickAgentRun).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a card a person moved', { status: 'todo' }, 'task_moved'],
    ['a card handed to someone else', { assigneeId: 'agent-2' }, 'reassigned'],
    [
      'an archived project',
      { project: { archivedAt: 1_700_000_000_000, teamIds: [] } },
      'project_archived',
    ],
    [
      'a starter who may no longer edit',
      { member: { role: 'member' } },
      'not_permitted',
    ],
  ] satisfies [string, World, string][])(
    'judges every final refusal before the busy agent (%s)',
    async (_label, world, reason) => {
      const lines = await deliver({ ...world, busy: elsewhere });

      expect(lines).toEqual([`[task-agent] auto-retry skipped: ${reason}`]);
      expect(probes).toHaveLength(0);
      expect(addJobInTx).not.toHaveBeenCalled();
      expect(kickAgentRun).not.toHaveBeenCalled();
    },
  );

  it('waits instead of spending an hour whose budget is full', async () => {
    const now = Date.now();

    await deliver({
      busy: elsewhere,
      automatedStarts: [now - 50_000, now - 40_000, now - 30_000],
    });

    expect(addJobInTx).toHaveBeenCalledTimes(1);
    expect(
      statements.some((text) => text.includes('INSERT INTO app.task_activity')),
    ).toBe(false);
  });

  it('ends as before when the agent is gone', async () => {
    const lines = await deliver({ agentGone: true, busy: elsewhere });

    expect(lines).toEqual(['[task-agent] auto-retry skipped: agent_gone']);
    expect(probes).toHaveLength(0);
    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(retireAutoRetry).toHaveBeenCalledWith(...retiredWith(true));
  });
});
