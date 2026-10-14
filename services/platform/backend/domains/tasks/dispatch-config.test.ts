import type { ProjectDispatch } from '@tale/shared/schemas/project-dispatch';
import { projectDispatchSchema } from '@tale/shared/schemas/project-dispatch';
import type { Sql, TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkProjectDispatch,
  readProjectDispatchConfiguration,
  saveProjectDispatch,
} from './dispatch-config.ts';
import { readStoredDispatch } from './dispatch-store.ts';

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
    assertReadable: vi.fn(),
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

describe('a stored dispatch this version cannot read is never overwritten [TASK-R52]', () => {
  const ada = {
    organizationId: 'org-1',
    userId: 'ada',
    role: 'admin',
    teamIds: [],
  };

  /** A database holding a dispatch a newer version wrote, with a field this
   * one does not know; it records every statement it is sent. */
  function databaseWithNewerDispatch() {
    const statements: string[] = [];
    const query = (strings: TemplateStringsArray) => {
      const text = strings.join('?');
      statements.push(text);
      if (text.includes('FROM app.project_dispatch'))
        return Promise.resolve([
          {
            config: { ...dispatch, quorum: 2 },
            updatedAt: 1,
            updatedBy: 'ada',
          },
        ]);
      return Promise.resolve([]);
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the readers use only the tagged template; one row models the stored document
    return { sql: query as unknown as TransactionSql, statements };
  }

  it('acts on it as on none, so nothing starts on what this version does not understand', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sql } = databaseWithNewerDispatch();
    await expect(readStoredDispatch(sql, 'org-1', 'p-1')).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('refuses it to managed configuration instead of reading it as missing', async () => {
    const { sql } = databaseWithNewerDispatch();
    await expect(
      readProjectDispatchConfiguration(sql, ada, 'p-1'),
    ).rejects.toMatchObject({ code: 'CONFIG_UNREADABLE' });
  });

  it.each([null, undefined])(
    'refuses a save over it, whatever the caller reviewed (expected hash %s)',
    async (expectedHash) => {
      const { sql, statements } = databaseWithNewerDispatch();
      await expect(
        saveProjectDispatch(sql, ada, {
          projectId: 'p-1',
          dispatch,
          expectedHash,
        }),
      ).rejects.toMatchObject({ code: 'CONFIG_UNREADABLE' });
      expect(statements.filter((text) => !text.includes('SELECT'))).toEqual([]);
    },
  );
});
