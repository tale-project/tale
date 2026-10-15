import {
  sandboxQuotaConfigSchema,
  SANDBOX_SESSION_BUDGET_MAX,
} from '@tale/shared/schemas/governance';
import type { ProjectDispatch } from '@tale/shared/schemas/project-dispatch';
import {
  DISPATCH_RUNS_MAX,
  projectDispatchSchema,
} from '@tale/shared/schemas/project-dispatch';
import type { Sql, TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkProjectDispatch,
  checkProjectDispatchSave,
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

describe('a declaration whose dispatch would be refused writes nothing [TASK-R61]', () => {
  const ada = {
    organizationId: 'org-1',
    userId: 'ada',
    role: 'admin',
    teamIds: [],
  };
  const gated: ProjectDispatch = {
    ...dispatch,
    gates: [{ key: 'ci', labels: ['optional-ci'] }],
  };

  /** A database that knows the project's agents, tasks, labels and stored
   * dispatch; it records every statement it is sent. */
  function recordingDatabase(rows: {
    agents: string[];
    labels: string[];
    stored?: ProjectDispatch;
  }) {
    const statements: string[] = [];
    const query = (strings: TemplateStringsArray) => {
      const text = strings.join('?');
      statements.push(text);
      if (text.includes('FROM app.project_agents'))
        return Promise.resolve(rows.agents.map((id) => ({ id })));
      if (text.includes('FROM app.tasks'))
        return Promise.resolve([{ id: 'task-manager', archived: false }]);
      if (text.includes('FROM app.task_labels'))
        return Promise.resolve(rows.labels.map((name) => ({ name })));
      if (text.includes('FROM app.project_dispatch') && rows.stored)
        return Promise.resolve([
          { config: rows.stored, updatedAt: 1, updatedBy: 'ada' },
        ]);
      if (text.includes('RETURNING')) return Promise.resolve([{ id: 'row-1' }]);
      return Promise.resolve([]);
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the save and its check use only the tagged template; rows model their reads
    const sql = query as unknown as TransactionSql;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the save serializes its JSON column through the transaction
    Object.assign(sql, { json: (value: unknown) => value });
    // Anything that leaves a trace: a row, an audit entry, a job, a hint.
    const writes = () =>
      statements.filter((text) =>
        /\b(INSERT|UPDATE|DELETE)\b|pg_notify|pgboss/i.test(text),
      );
    return { sql, statements, writes };
  }

  it('answers what a save would answer, and sends no write', async () => {
    // Switched off, so the save asks for no pass and needs no job queue.
    const off = { ...gated, enabled: false };
    const checked = recordingDatabase({
      agents: ['scribe', 'lector'],
      labels: ['optional-ci'],
    });
    const verdict = await checkProjectDispatchSave(checked.sql, ada, {
      projectId: 'p-1',
      dispatch: off,
      expectedHash: null,
    });
    expect(checked.writes()).toEqual([]);
    const saved = recordingDatabase({
      agents: ['scribe', 'lector'],
      labels: ['optional-ci'],
    });
    const result = await saveProjectDispatch(saved.sql, ada, {
      projectId: 'p-1',
      dispatch: off,
      expectedHash: null,
    });
    expect(verdict).toEqual({ ok: true, ...result });
    expect(saved.writes()).not.toEqual([]);
  });

  it('answers unchanged for the dispatch already stored', async () => {
    const { sql, writes } = recordingDatabase({
      agents: ['scribe', 'lector'],
      labels: ['optional-ci'],
      stored: gated,
    });
    await expect(
      checkProjectDispatchSave(sql, ada, {
        projectId: 'p-1',
        dispatch: gated,
      }),
    ).resolves.toMatchObject({ ok: true, changed: false });
    expect(writes()).toEqual([]);
  });

  it('answers the fields a save would refuse, and sends no write', async () => {
    const { sql, writes } = recordingDatabase({
      agents: ['scribe'],
      labels: [],
    });
    const verdict = await checkProjectDispatchSave(sql, ada, {
      projectId: 'p-1',
      dispatch: gated,
      expectedHash: null,
    });
    expect(verdict).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({ path: 'agents.1' }),
        expect.objectContaining({ path: 'gates.0.labels.0' }),
      ],
    });
    expect(writes()).toEqual([]);
    await expect(
      saveProjectDispatch(
        recordingDatabase({ agents: ['scribe'], labels: [] }).sql,
        ada,
        {
          projectId: 'p-1',
          dispatch: gated,
          expectedHash: null,
        },
      ),
    ).rejects.toMatchObject({
      code: 'DISPATCH_INVALID',
      data: { issues: verdict.ok ? [] : verdict.issues },
    });
  });

  it('refuses who may not administer the project and a stored dispatch the caller did not review, as a save does', async () => {
    vi.mocked(service.assertProjectAdministrable).mockImplementationOnce(() => {
      throw new service.ProjectError(
        'PROJECT_FORBIDDEN',
        'No project access',
        403,
      );
    });
    const tx = vi.fn();
    await expect(
      checkProjectDispatchSave(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the refusal comes before any statement
        tx as unknown as TransactionSql,
        { ...ada, userId: 'mia', role: 'member' },
        { projectId: 'p-1', dispatch: gated, expectedHash: null },
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_FORBIDDEN' });
    expect(tx).not.toHaveBeenCalled();
    const { sql, writes } = recordingDatabase({
      agents: ['scribe', 'lector'],
      labels: ['optional-ci'],
      stored: dispatch,
    });
    await expect(
      checkProjectDispatchSave(sql, ada, {
        projectId: 'p-1',
        dispatch: gated,
        expectedHash: null,
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    expect(writes()).toEqual([]);
  });
});

describe('a dispatch holds up to 500 runs, one agent at most as many as the pool [TASK-R62]', () => {
  const coder: ProjectDispatch = {
    enabled: true,
    agents: ['coder'],
    maxConcurrentRuns: 256,
    perAgentConcurrency: 256,
    statuses: ['todo'],
    assignment: 'pool',
  };

  it('takes as many runs at once, and per agent, as an organization may have agent workers', () => {
    expect(DISPATCH_RUNS_MAX).toBe(500);
    expect(DISPATCH_RUNS_MAX).toBe(SANDBOX_SESSION_BUDGET_MAX);
    expect(
      sandboxQuotaConfigSchema.safeParse({ maxSessionsPerOrg: 500 }).success,
    ).toBe(true);
    expect(
      sandboxQuotaConfigSchema.safeParse({ maxSessionsPerOrg: 501 }).success,
    ).toBe(false);
    expect(projectDispatchSchema.safeParse(coder).success).toBe(true);
    expect(
      projectDispatchSchema.safeParse({
        ...coder,
        maxConcurrentRuns: 500,
        perAgentConcurrency: 500,
      }).success,
    ).toBe(true);
    for (const field of ['maxConcurrentRuns', 'perAgentConcurrency']) {
      expect(
        projectDispatchSchema.safeParse({
          ...coder,
          maxConcurrentRuns: 500,
          [field]: 501,
        }).success,
      ).toBe(false);
    }
  });

  it('refuses one agent holding more runs than the whole pool, naming runs per agent', () => {
    const refused = projectDispatchSchema.safeParse({
      ...coder,
      maxConcurrentRuns: 200,
    });
    expect(refused.error?.issues).toMatchObject([
      { path: ['perAgentConcurrency'] },
    ]);
    // Left out, an agent holds one run: never more than the pool.
    const { perAgentConcurrency: _perAgent, ...lean } = coder;
    expect(
      projectDispatchSchema.safeParse({ ...lean, maxConcurrentRuns: 1 })
        .success,
    ).toBe(true);
  });

  it('still reads and starts a dispatch saved before the rule, whose agent holds more than the pool', async () => {
    const saved = { ...coder, maxConcurrentRuns: 2, perAgentConcurrency: 5 };
    const query = (strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join('?').includes('FROM app.project_dispatch')
          ? [{ config: saved, updatedAt: 1, updatedBy: 'ada' }]
          : [],
      );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reader uses only the tagged template; one row models the stored document
    const sql = query as unknown as TransactionSql;
    await expect(readStoredDispatch(sql, 'org-1', 'p-1')).resolves.toEqual({
      config: saved,
      updatedAt: 1,
      updatedBy: 'ada',
    });
  });
});
