import type { ProjectDispatch } from '@tale/shared/schemas/project-dispatch';
import { projectDispatchSchema } from '@tale/shared/schemas/project-dispatch';
import type { Sql, TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkProjectDispatch,
  saveProjectDispatch,
} from './dispatch-config.ts';

vi.mock('../projects/service.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../projects/service.ts')>();
  return {
    ...actual,
    loadProjectOrThrow: vi.fn(() =>
      Promise.resolve({ id: 'p-1', name: 'Fleet', archivedAt: null }),
    ),
    assertProjectAdministrable: vi.fn(),
    assertProjectActive: vi.fn(),
  };
});

const service = await import('../projects/service.ts');

const dispatch: ProjectDispatch = {
  enabled: true,
  agents: ['scribe', 'lector'],
  maxConcurrentRuns: 2,
  statuses: ['todo'],
  assignment: 'assigned',
  standingRoles: [
    {
      key: 'manager',
      taskId: 'task-manager',
      agentId: 'scribe',
      cron: '0 * * * *',
      timezone: 'Europe/Zurich',
    },
  ],
};

/** A database that knows the project's agents and tasks. */
function databaseWith(rows: {
  agents: string[];
  tasks: Array<{ id: string; archived: boolean }>;
}): Sql {
  const query = (strings: TemplateStringsArray) => {
    const text = strings.join('?');
    if (text.includes('FROM app.project_agents'))
      return Promise.resolve(rows.agents.map((id) => ({ id })));
    if (text.includes('FROM app.tasks')) return Promise.resolve(rows.tasks);
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the check uses only the tagged template; rows model its two reads
  return query as unknown as Sql;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('a dispatch names only what is the project’s, and only who administers it changes it [TASK-R48]', () => {
  it('accepts a document whose agents, tasks and schedules check out', async () => {
    await expect(
      checkProjectDispatch(
        databaseWith({
          agents: ['scribe', 'lector'],
          tasks: [{ id: 'task-manager', archived: false }],
        }),
        { organizationId: 'org-1', projectId: 'p-1', dispatch },
      ),
    ).resolves.toEqual([]);
  });

  it('names every agent, task and schedule it cannot accept', async () => {
    const issues = await checkProjectDispatch(
      databaseWith({
        agents: ['scribe'],
        tasks: [{ id: 'task-manager', archived: true }],
      }),
      {
        organizationId: 'org-1',
        projectId: 'p-1',
        dispatch: {
          ...dispatch,
          standingRoles: [
            {
              key: 'manager',
              taskId: 'task-manager',
              agentId: 'ghost',
              cron: 'sixty past',
              timezone: 'Europe/Zurich',
            },
          ],
        },
      },
    );
    expect(issues.map((issue) => issue.path)).toEqual([
      'agents.1',
      'standingRoles.0.agentId',
      'standingRoles.0.taskId',
      'standingRoles.0.cron',
    ]);
  });

  it('refuses a change by someone who may not administer the project, before reading anything else', async () => {
    vi.mocked(service.assertProjectAdministrable).mockImplementationOnce(() => {
      throw new service.ProjectError(
        'PROJECT_FORBIDDEN',
        'No project access',
        403,
      );
    });
    const tx = vi.fn();
    await expect(
      saveProjectDispatch(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the refusal comes before any statement
        tx as unknown as TransactionSql,
        {
          organizationId: 'org-1',
          userId: 'mia',
          role: 'member',
          teamIds: [],
        },
        { projectId: 'p-1', dispatch, expectedHash: null },
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_FORBIDDEN' });
    expect(tx).not.toHaveBeenCalled();
  });

  it('refuses a document that repeats a role key or an agent', () => {
    expect(
      projectDispatchSchema.safeParse({
        ...dispatch,
        agents: ['scribe', 'scribe'],
      }).success,
    ).toBe(false);
    const role = dispatch.standingRoles?.[0];
    expect(
      projectDispatchSchema.safeParse({
        ...dispatch,
        standingRoles: [role, role],
      }).success,
    ).toBe(false);
  });
});
