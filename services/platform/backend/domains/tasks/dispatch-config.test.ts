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

import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import {
  checkPlannedProjectDispatch,
  checkProjectDispatch,
  checkProjectDispatchSave,
  readProjectDispatchConfiguration,
  saveProjectDispatch,
} from './dispatch-config.ts';
import {
  dispatchConfigurationValue,
  readStoredDispatch,
} from './dispatch-store.ts';

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

const auth = {
  organizationId: 'org-1',
  userId: 'admin-1',
  role: 'admin',
  teamIds: [],
};

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
        { organizationId: 'org-1', projectId: 'p-1', dispatch, auth },
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
        auth,
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
        return Promise.resolve(
          rows.labels.map((name) => ({ projectId: 'p-1', name })),
        );
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

describe('a dispatch check counts what its declaration creates; its save, only what exists [TASK-R69]', () => {
  const ada = {
    organizationId: 'org-1',
    userId: 'ada',
    role: 'admin',
    teamIds: [],
  };
  const labelled: ProjectDispatch = {
    ...dispatch,
    labels: { include: ['Release'] },
  };
  /** The declaration creates the second agent, the standing role's task and
   * the label; the project holds the first agent alone. */
  const planned = {
    agents: ['lector'],
    tasks: ['task-manager'],
    labels: ['release'],
  };
  function holding(agents: string[]) {
    const query = (strings: TemplateStringsArray) => {
      const text = strings.join('?');
      if (text.includes('FROM app.project_agents'))
        return Promise.resolve(agents.map((id) => ({ id })));
      return Promise.resolve([]);
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the check and the save use only the tagged template here
    const sql = query as unknown as TransactionSql;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the save serializes its JSON column through the transaction
    Object.assign(sql, { json: (value: unknown) => value });
    return sql;
  }

  it('passes a dispatch naming the agents, tasks and labels the declaration creates', async () => {
    await expect(
      checkProjectDispatch(holding(['scribe']), {
        organizationId: 'org-1',
        projectId: 'p-1',
        dispatch: labelled,
        auth: ada,
        planned,
      }),
    ).resolves.toEqual([]);
    await expect(
      checkProjectDispatchSave(holding(['scribe']), ada, {
        projectId: 'p-1',
        dispatch: labelled,
        expectedHash: null,
        planned,
      }),
    ).resolves.toMatchObject({ ok: true, changed: true });
  });

  it('still names what neither the project nor the declaration has', async () => {
    const issues = await checkProjectDispatch(holding(['scribe']), {
      organizationId: 'org-1',
      projectId: 'p-1',
      dispatch: labelled,
      auth: ada,
      planned: { agents: [], tasks: [], labels: [] },
    });
    expect(issues.map((issue) => issue.path)).toEqual([
      'agents.1',
      'standingRoles.0.taskId',
      'labels.include.0',
    ]);
  });

  it('saves against what exists alone, whatever a caller says it planned', async () => {
    await expect(
      saveProjectDispatch(holding(['scribe']), ada, {
        projectId: 'p-1',
        dispatch: labelled,
        expectedHash: null,
        planned,
      }),
    ).rejects.toMatchObject({ code: 'DISPATCH_INVALID' });
  });

  it('checks a project the declaration creates against the declaration alone, for who may administer it', async () => {
    await expect(
      checkPlannedProjectDispatch(holding([]), ada, {
        projectId: 'p-new',
        dispatch: {
          ...labelled,
          // Every new project starts with these labels.
          labels: { include: ['Release', 'bug'] },
        },
        expectedHash: null,
        planned: { ...planned, agents: ['scribe', 'lector'], project: true },
      }),
    ).resolves.toMatchObject({ ok: true, changed: true });
    await expect(
      checkPlannedProjectDispatch(holding([]), ada, {
        projectId: 'p-new',
        dispatch: labelled,
        expectedHash: null,
        planned: { ...planned, project: true },
      }),
    ).resolves.toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({ path: 'agents.0' }),
        expect.objectContaining({ path: 'standingRoles.0.agentId' }),
      ],
    });
    await expect(
      checkPlannedProjectDispatch(
        holding([]),
        { ...ada, role: 'editor' },
        {
          projectId: 'p-new',
          dispatch: labelled,
          expectedHash: null,
          planned: { ...planned, project: true },
        },
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_FORBIDDEN' });
  });
});

describe('a dispatch serves another board only when its writer may edit that board [TASK-R70]', () => {
  /** Development's administrator Ada edits Tale; Billing is shared with a
   * team she is not in; Archive is archived; Elsewhere is in another
   * organization. Development has a Coder, a Reviewer granted task review
   * and a Reporter without it; Tale has the label `ready`. */
  const ada = {
    organizationId: 'org-1',
    userId: 'ada',
    role: 'editor',
    teamIds: ['team-dev', 'team-tale'],
  };
  const PROJECTS: Record<
    string,
    { archived: boolean; teamIds: string[]; organizationId: string }
  > = {
    'p-tale': {
      archived: false,
      teamIds: ['team-tale'],
      organizationId: 'org-1',
    },
    'p-vat': {
      archived: false,
      teamIds: ['team-vat'],
      organizationId: 'org-1',
    },
    'p-archive': { archived: true, teamIds: [], organizationId: 'org-1' },
  };
  const AGENTS = [
    { id: 'scribe', tools: ['task_review'] },
    { id: 'lector', tools: [] },
    { id: 'reviewer', tools: ['task_review'] },
    { id: 'reporter', tools: ['task_comment'] },
  ];
  const LABELS = [
    { projectId: 'p-1', name: 'release' },
    { projectId: 'p-tale', name: 'ready' },
  ];

  function database(): Sql {
    const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      if (text.includes('FROM app.project_agents'))
        return Promise.resolve(AGENTS);
      if (text.includes('FROM app.tasks'))
        return Promise.resolve([{ id: 'task-manager', archived: false }]);
      if (text.includes('FROM app.projects')) {
        const ids = values.find(Array.isArray) ?? [];
        return Promise.resolve(
          (ids as string[]).flatMap((id) => {
            const project = PROJECTS[id];
            return project === undefined
              ? []
              : [{ id, archived: project.archived, teamIds: project.teamIds }];
          }),
        );
      }
      if (text.includes('FROM app.task_labels')) {
        const projectIds = values.find(Array.isArray) ?? [];
        return Promise.resolve(
          LABELS.filter((label) =>
            (projectIds as string[]).includes(label.projectId),
          ),
        );
      }
      return Promise.resolve([]);
    };
    const unsafe = (text: string) => text;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the check uses only the tagged template and unsafe; the rows model its reads
    return Object.assign(query, { unsafe }) as unknown as Sql;
  }

  const check = (fields: Partial<ProjectDispatch>) =>
    checkProjectDispatch(database(), {
      organizationId: 'org-1',
      projectId: 'p-1',
      dispatch: { ...dispatch, standingRoles: undefined, ...fields },
      auth: ada,
    });

  it('accepts a board its writer may edit, with that board’s labels and the project’s reviewers', async () => {
    await expect(
      check({
        sources: [{ projectId: 'p-tale', labels: { include: ['ready'] } }],
        reviewers: ['reviewer'],
        gates: [{ key: 'ci', labels: ['ready'] }],
      }),
    ).resolves.toEqual([]);
  });

  it('names a board its writer may not edit, an archived one, one of no project, and its own', async () => {
    const issues = await check({
      sources: [
        { projectId: 'p-vat' },
        { projectId: 'p-archive' },
        { projectId: 'p-elsewhere' },
        { projectId: 'p-1' },
      ],
    });
    expect(issues).toEqual([
      {
        path: 'sources.0.projectId',
        message:
          'Serving that project’s board needs the right to edit it, which you do not have.',
      },
      {
        path: 'sources.1.projectId',
        message: 'That project is archived; restore it first.',
      },
      {
        path: 'sources.2.projectId',
        message:
          'No project with the id "p-elsewhere" is in this organization.',
      },
      {
        path: 'sources.3.projectId',
        message:
          'A dispatch serves its own board already; a source names another project.',
      },
    ]);
  });

  it('never lets a project’s own API key serve another project', async () => {
    const issues = await checkProjectDispatch(database(), {
      organizationId: 'org-1',
      projectId: 'p-1',
      dispatch: {
        ...dispatch,
        standingRoles: undefined,
        sources: [{ projectId: 'p-tale' }],
      },
      auth: { ...ada, role: 'admin', projectScope: 'p-1' },
    });
    expect(issues.map((issue) => issue.path)).toEqual(['sources.0.projectId']);
  });

  it('names a source’s label its board lacks, and a reviewer that is not the project’s or may not review', async () => {
    const issues = await check({
      sources: [{ projectId: 'p-tale', labels: { exclude: ['release'] } }],
      reviewers: ['reporter', 'ghost'],
      gates: [{ key: 'ci', labels: ['nowhere'] }],
    });
    expect(issues).toEqual([
      {
        path: 'reviewers.0',
        message:
          'The agent "reporter" may not review tasks; grant it task review first.',
      },
      {
        path: 'reviewers.1',
        message: 'No agent with the id "ghost" works in this project.',
      },
      {
        path: 'sources.0.labels.exclude.0',
        message: 'No label named "release" is in that project.',
      },
      {
        path: 'gates.0.labels.0',
        message:
          'No label named "nowhere" is in this project or any project it serves.',
      },
    ]);
  });

  it('reads, hashes and saves a dispatch that names no other board exactly as before', () => {
    const stored = {
      ...dispatch,
      gates: [{ key: 'ci', labels: ['release'] }],
    };
    const parsed = projectDispatchSchema.parse(stored);
    expect(parsed).toEqual(stored);
    expect('sources' in parsed || 'reviewers' in parsed).toBe(false);
    expect(
      managedConfigurationHash(dispatchConfigurationValue('p-1', parsed)),
    ).toBe(managedConfigurationHash({ projectId: 'p-1', ...stored }));
  });
});

describe('a board served on a right that was lost is served again once someone who may edit it saves the dispatch [TASK-R72]', () => {
  /** Development's dispatch serves Tale, saved last by Ada; Bea edits Tale
   * too. */
  const serving: ProjectDispatch = {
    ...dispatch,
    standingRoles: undefined,
    sources: [{ projectId: 'p-tale' }],
  };
  const bea = {
    organizationId: 'org-1',
    userId: 'bea',
    role: 'editor',
    teamIds: ['team-tale'],
  };

  function storedAs(stored: ProjectDispatch): TransactionSql {
    const query = (strings: TemplateStringsArray) => {
      const text = strings.join('?');
      if (text.includes('FROM app.project_agents'))
        return Promise.resolve(
          ['scribe', 'lector'].map((id) => ({ id, tools: [] })),
        );
      if (text.includes('FROM app.projects'))
        return Promise.resolve([
          { id: 'p-tale', archived: false, teamIds: ['team-tale'] },
        ]);
      if (text.includes('FROM app.project_dispatch'))
        return Promise.resolve([
          { config: stored, updatedAt: 1, updatedBy: 'ada' },
        ]);
      return Promise.resolve([]);
    };
    const unsafe = (text: string) => text;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the check uses only the tagged template and unsafe; the rows model its reads
    return Object.assign(query, { unsafe }) as unknown as TransactionSql;
  }

  it('saves the same document again when someone else saves it, so it serves its boards on their right', async () => {
    await expect(
      checkProjectDispatchSave(storedAs(serving), bea, {
        projectId: 'p-1',
        dispatch: serving,
      }),
    ).resolves.toMatchObject({ ok: true, changed: true });
    await expect(
      checkProjectDispatchSave(
        storedAs(serving),
        { ...bea, userId: 'ada' },
        { projectId: 'p-1', dispatch: serving },
      ),
    ).resolves.toMatchObject({ ok: true, changed: false });
  });

  it('leaves a dispatch that serves no other board unchanged, whoever saves it', async () => {
    const own = { ...dispatch, standingRoles: undefined };
    await expect(
      checkProjectDispatchSave(storedAs(own), bea, {
        projectId: 'p-1',
        dispatch: own,
      }),
    ).resolves.toMatchObject({ ok: true, changed: false });
  });
});
