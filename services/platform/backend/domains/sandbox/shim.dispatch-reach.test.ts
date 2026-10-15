// @vitest-environment node

/**
 * A project agent's task tools reach the boards its own project's dispatch
 * serves, and nothing beyond: the tool door widens the run's project scope by
 * the boards the agent reaches now, and a run working a board it no longer
 * reaches acts for nobody.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readAgentReach } from '../tasks/dispatch-reach.ts';
import { sandboxToolShimHandlers } from './shim.ts';

vi.mock('../tasks/dispatch-reach.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tasks/dispatch-reach.ts')>()),
  readAgentReach: vi.fn(),
}));

const STANDING = 'pa-coder';

/** The Coder of Development, on a run an editor of both boards started. */
function fakeSql(run: { projectId: string }): Sql {
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM app.sandbox_sessions')) {
      return Promise.resolve([
        { ownerType: 'project_agent', ownerId: 'coder' },
      ]);
    }
    if (text.includes('FROM app.project_agents')) {
      return Promise.resolve([{ id: 'coder', projectId: 'p-dev' }]);
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
          startedBy: 'ada',
          startedAt: 10,
          launchedAt: 11,
        },
      ]);
    }
    if (text.includes('AS "teamIds"')) {
      const ids = values.find(Array.isArray) ?? [];
      return Promise.resolve(
        (ids as string[]).map((id) => ({ id, teamIds: [] })),
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
