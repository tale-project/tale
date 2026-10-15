// @vitest-environment node

/**
 * A project agent's task tools reach the boards its own project's dispatch
 * serves, and nothing beyond: the tool door widens the run's project scope by
 * the boards the agent reaches now that the run's starter may act in, and a
 * run working a board it no longer reaches acts for nobody. A person who
 * edits only the served board gets a confined run: the agent's own project's
 * equipment is not theirs.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  agentReachesProject,
  dispatchReachesSource,
  readAgentReach,
} from '../tasks/dispatch-reach.ts';
import { sandboxToolShimHandlers } from './shim.ts';

vi.mock('../tasks/dispatch-reach.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tasks/dispatch-reach.ts')>()),
  readAgentReach: vi.fn(),
  agentReachesProject: vi.fn(),
  dispatchReachesSource: vi.fn(),
}));

const STANDING = 'pa-coder';

/** The Coder of Development (`p-dev`), on a run of a task of `run.projectId`
 * that `run.startedBy` started. Ada is an editor; a project whose `teams`
 * names a team is one she is outside of, and may not edit. */
function fakeSql(
  run: { projectId: string; startedBy?: string },
  teams: Record<string, string[]> = {},
): Sql {
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM app.sandbox_sessions')) {
      return Promise.resolve([
        { ownerType: 'project_agent', ownerId: 'coder' },
      ]);
    }
    if (text.includes('FROM app.project_agents')) {
      return Promise.resolve([
        { id: 'coder', projectId: 'p-dev', archived: false },
      ]);
    }
    if (text.includes('FROM app.project_agent_runs')) {
      return Promise.resolve([
        {
          runId: 'run-1',
          execId: 'exec-1',
          taskId: 'task-tale',
          projectId: run.projectId,
          agentId: 'coder',
          sessionId: STANDING,
          startedBy: run.startedBy ?? 'ada',
          startedAt: 10,
          launchedAt: 11,
        },
      ]);
    }
    if (text.includes('FROM app.project_dispatch')) {
      // Development's dispatch is switched on.
      return Promise.resolve([{ id: 'p-dev' }]);
    }
    if (text.includes('AS "teamIds"')) {
      const ids = values.find(Array.isArray) ?? [];
      return Promise.resolve(
        (ids as string[]).map((id) => ({ id, teamIds: teams[id] ?? [] })),
      );
    }
    if (text.includes('FROM app.projects')) {
      return Promise.resolve([{ id: 'p-dev' }]);
    }
    if (text.includes('FROM "member"')) {
      return Promise.resolve([
        { id: 'm', organizationId: 'org-1', userId: 'ada', role: 'editor' },
      ]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the members the binding and run reads reach
  return Object.assign(fn, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
}

async function context(sql: Sql): Promise<unknown> {
  const resolve =
    sandboxToolShimHandlers(sql)[
      'sandbox/workspace_access:resolveSessionActionContext'
    ];
  if (resolve === undefined) throw new Error('no handler');
  return resolve({
    organizationId: 'org-1',
    subject: 'tasks',
    effect: 'write',
    sessionId: STANDING,
    taskRunExecId: 'exec-1',
  });
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('the agents of a dispatch work the boards it serves like their own [TASK-R73]', () => {
  it('widens a run’s project scope by the boards its project’s dispatch serves', async () => {
    vi.mocked(readAgentReach).mockResolvedValue({
      homeProjectId: 'p-dev',
      reachedProjectIds: ['p-tale'],
    });
    vi.mocked(agentReachesProject).mockResolvedValue(true);
    expect(await context(fakeSql({ projectId: 'p-tale' }))).toEqual({
      allowed: true,
      actorId: 'coder',
      scope: {
        kind: 'project',
        projectId: 'p-dev',
        reachedProjectIds: ['p-tale'],
      },
    });
  });

  it('keeps an agent that reaches nothing to its own project', async () => {
    vi.mocked(readAgentReach).mockResolvedValue({
      homeProjectId: 'p-dev',
      reachedProjectIds: [],
    });
    expect(await context(fakeSql({ projectId: 'p-dev' }))).toEqual({
      allowed: true,
      actorId: 'coder',
      scope: { kind: 'project', projectId: 'p-dev' },
    });
  });

  it('lets a run on a board no longer served act for nobody [TASK-R72]', async () => {
    vi.mocked(readAgentReach).mockResolvedValue({
      homeProjectId: 'p-dev',
      reachedProjectIds: [],
    });
    expect(await context(fakeSql({ projectId: 'p-tale' }))).toEqual({
      allowed: false,
      reason: 'schedule_revoked',
    });
  });
});

describe('a person’s run on a board another project’s dispatch serves answers to both projects [TASK-R79]', () => {
  it('confines a run started by someone who edits only the served board, and reaches that board alone', async () => {
    vi.mocked(readAgentReach).mockResolvedValue({
      homeProjectId: 'p-dev',
      reachedProjectIds: ['p-tale', 'p-jordi'],
    });
    vi.mocked(agentReachesProject).mockResolvedValue(true);
    // Ada edits Tale's board, but neither Development nor Jordi's.
    const sql = fakeSql(
      { projectId: 'p-tale' },
      { 'p-dev': ['team-dev'], 'p-jordi': ['team-jordi'] },
    );
    expect(await context(sql)).toEqual({
      allowed: true,
      actorId: 'coder',
      scope: {
        kind: 'project',
        projectId: 'p-dev',
        reachedProjectIds: ['p-tale'],
      },
      confinedToTaskId: 'task-tale',
    });
  });

  it('confines a run started by someone who edits only the agent’s own project', async () => {
    vi.mocked(readAgentReach).mockResolvedValue({
      homeProjectId: 'p-dev',
      reachedProjectIds: ['p-tale', 'p-jordi'],
    });
    vi.mocked(agentReachesProject).mockResolvedValue(true);
    // Ada edits Development, but neither served board: her run works its
    // own task, on its own board, and nothing of Jordi's.
    const sql = fakeSql(
      { projectId: 'p-tale' },
      { 'p-tale': ['team-tale'], 'p-jordi': ['team-jordi'] },
    );
    expect(await context(sql)).toEqual({
      allowed: true,
      actorId: 'coder',
      scope: {
        kind: 'project',
        projectId: 'p-dev',
        reachedProjectIds: ['p-tale'],
      },
      confinedToTaskId: 'task-tale',
    });
  });

  it('keeps a run of the agent’s own board to the boards its starter may edit', async () => {
    vi.mocked(readAgentReach).mockResolvedValue({
      homeProjectId: 'p-dev',
      reachedProjectIds: ['p-tale', 'p-jordi'],
    });
    // Ada edits Development and Tale's board; Jordi's is not hers.
    const sql = fakeSql({ projectId: 'p-dev' }, { 'p-jordi': ['team-jordi'] });
    expect(await context(sql)).toEqual({
      allowed: true,
      actorId: 'coder',
      scope: {
        kind: 'project',
        projectId: 'p-dev',
        reachedProjectIds: ['p-tale'],
      },
    });
  });

  it('lets a run its own project’s dispatch started reach every board that dispatch serves', async () => {
    vi.mocked(readAgentReach).mockResolvedValue({
      homeProjectId: 'p-dev',
      reachedProjectIds: ['p-tale', 'p-jordi'],
    });
    vi.mocked(agentReachesProject).mockResolvedValue(true);
    vi.mocked(dispatchReachesSource).mockResolvedValue(true);
    const sql = fakeSql(
      { projectId: 'p-tale', startedBy: 'dispatch:p-dev' },
      { 'p-dev': ['team-dev'], 'p-jordi': ['team-jordi'] },
    );
    expect(await context(sql)).toEqual({
      allowed: true,
      actorId: 'coder',
      scope: {
        kind: 'project',
        projectId: 'p-dev',
        reachedProjectIds: ['p-tale', 'p-jordi'],
      },
    });
  });

  it('confines a person’s run on a board the agent no longer reaches before it acts', async () => {
    vi.mocked(readAgentReach).mockResolvedValue({
      homeProjectId: 'p-dev',
      reachedProjectIds: ['p-tale'],
    });
    // The reach the run's tools were bound with still lists the board, but
    // the agent's start-time check no longer does: no full equipment.
    vi.mocked(agentReachesProject).mockResolvedValue(false);
    expect(await context(fakeSql({ projectId: 'p-tale' }))).toEqual({
      allowed: true,
      actorId: 'coder',
      scope: {
        kind: 'project',
        projectId: 'p-dev',
        reachedProjectIds: ['p-tale'],
      },
      confinedToTaskId: 'task-tale',
    });
  });
});
