import type { ProjectDispatch } from '@tale/shared/schemas/project-dispatch';
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  agentReachesProject,
  agentsServingProject,
  authorityReaches,
  dispatchesServing,
  dispatchReachAgents,
  dispatchReachesSource,
  judgeDispatchSources,
  judgeSource,
  readAgentReach,
} from './dispatch-reach.ts';
import { memberEditableProjects } from './edit-right.ts';

vi.mock('./edit-right.ts', () => ({
  memberEditableProjects: vi.fn(),
}));

/** Development serves Tale and Billing; its Coder is in the pool, its
 * Reviewer reviews, its Reporter is neither. */
const DEVELOPMENT: ProjectDispatch = {
  enabled: true,
  agents: ['coder'],
  maxConcurrentRuns: 256,
  perAgentConcurrency: 256,
  statuses: ['todo'],
  assignment: 'pool',
  sources: [{ projectId: 'tale' }, { projectId: 'billing' }],
  reviewers: ['reviewer'],
  standingRoles: [
    {
      key: 'manager',
      taskId: 'task-manager',
      agentId: 'manager',
      cron: '0 * * * *',
      timezone: 'Europe/Zurich',
    },
  ],
};

interface World {
  /** Agents by id: their project, and whether it is archived. */
  agents: Record<string, { projectId: string; archived?: boolean }>;
  /** Projects of the organization by id. */
  projects: Record<string, { name: string; archived?: boolean }>;
  /** Stored dispatches by project, with who last saved them. */
  dispatches: Record<
    string,
    { config: ProjectDispatch | 'unreadable'; updatedBy: string | null }
  >;
}

/** A database holding the world: the agent, project and dispatch reads the
 * reach makes, answered as Postgres would for the values they bind. */
function databaseOf(world: World): Sql {
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM app.project_agents a')) {
      const agent = world.agents[String(values[0])];
      return Promise.resolve(
        agent === undefined
          ? []
          : [{ projectId: agent.projectId, archived: agent.archived === true }],
      );
    }
    if (text.includes('FROM app.project_agents') && text.includes('ANY')) {
      const ids = values.find(Array.isArray) ?? [];
      return Promise.resolve(
        (ids as unknown[]).flatMap((id) => {
          const agent = world.agents[String(id)];
          return agent === undefined
            ? []
            : [
                {
                  id: String(id),
                  name: `Agent ${String(id)}`,
                  tools: id === 'reviewer' ? ['task_review'] : null,
                  projectId: agent.projectId,
                },
              ];
        }),
      );
    }
    if (text.includes('FROM app.project_dispatch d')) {
      const projectId = String(values[1]);
      return Promise.resolve(
        Object.entries(world.dispatches)
          .filter(
            ([id, stored]) =>
              id !== projectId &&
              stored.config !== 'unreadable' &&
              (stored.config.sources ?? []).some(
                (source) => source.projectId === projectId,
              ) &&
              world.projects[id]?.archived !== true,
          )
          .map(([id, stored]) => ({
            projectId: id,
            name: world.projects[id]?.name ?? id,
            enabled: stored.config !== 'unreadable' && stored.config.enabled,
            config: stored.config,
            updatedBy: stored.updatedBy,
          })),
      );
    }
    if (text.includes('FROM app.project_dispatch')) {
      const stored = world.dispatches[String(values[0])];
      return Promise.resolve(
        stored === undefined
          ? []
          : [
              {
                config:
                  stored.config === 'unreadable'
                    ? { enabled: 'maybe' }
                    : stored.config,
                updatedAt: 1,
                updatedBy: stored.updatedBy,
              },
            ],
      );
    }
    if (text.includes('FROM app.projects')) {
      const ids = values[1];
      return Promise.resolve(
        (Array.isArray(ids) ? ids : []).flatMap((id: unknown) => {
          const project = world.projects[String(id)];
          return project === undefined
            ? []
            : [
                {
                  id: String(id),
                  name: project.name,
                  archived: project.archived === true,
                },
              ];
        }),
      );
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(query, { json: (value: unknown) => value });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reach uses only the tagged template and json; the world models its reads
  return sql as unknown as Sql;
}

const WORLD: World = {
  agents: {
    coder: { projectId: 'development' },
    reviewer: { projectId: 'development' },
    manager: { projectId: 'development' },
    reporter: { projectId: 'development' },
    'tale-agent': { projectId: 'tale' },
  },
  projects: {
    development: { name: 'Development' },
    tale: { name: 'Tale' },
    billing: { name: 'Billing' },
  },
  dispatches: { development: { config: DEVELOPMENT, updatedBy: 'ada' } },
};

/** Ada may edit the projects named here. */
function adaEdits(...projectIds: string[]) {
  vi.mocked(memberEditableProjects).mockImplementation((_sql, args) =>
    Promise.resolve(
      new Set(
        args.userId === 'ada'
          ? args.projectIds.filter((id) => projectIds.includes(id))
          : [],
      ),
    ),
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('a board a dispatch can no longer reach is skipped, and says why [TASK-R72]', () => {
  it('judges a missing project first, then an archived one, then a lost right', () => {
    expect(
      judgeSource({ exists: false, archived: true, authorityMayEdit: false }),
    ).toBe('missing');
    expect(
      judgeSource({ exists: true, archived: true, authorityMayEdit: false }),
    ).toBe('archived');
    expect(
      judgeSource({ exists: true, archived: false, authorityMayEdit: false }),
    ).toBe('no_authority');
    expect(
      judgeSource({ exists: true, archived: false, authorityMayEdit: true }),
    ).toBeNull();
  });

  it('judges every source on the right of whoever last saved the dispatch, never anyone else’s', async () => {
    adaEdits('tale');
    const sql = databaseOf({
      ...WORLD,
      projects: {
        ...WORLD.projects,
        archived: { name: 'Archived', archived: true },
      },
    });
    const judged = await judgeDispatchSources(sql, {
      organizationId: 'org',
      sources: [
        { projectId: 'tale' },
        { projectId: 'billing' },
        { projectId: 'archived' },
        { projectId: 'gone' },
      ],
      authorityUserId: 'ada',
    });
    expect(
      judged.map(({ projectId, name, skipped }) => ({
        projectId,
        name,
        skipped,
      })),
    ).toEqual([
      { projectId: 'tale', name: 'Tale', skipped: null },
      { projectId: 'billing', name: 'Billing', skipped: 'no_authority' },
      { projectId: 'archived', name: 'Archived', skipped: 'archived' },
      { projectId: 'gone', name: null, skipped: 'missing' },
    ]);
    // An archived or missing project is never asked about.
    expect(vi.mocked(memberEditableProjects).mock.calls[0]?.[1]).toEqual({
      organizationId: 'org',
      userId: 'ada',
      projectIds: ['tale', 'billing'],
    });
  });

  it('reaches no source of a dispatch nobody saved', async () => {
    adaEdits('tale', 'billing');
    const judged = await judgeDispatchSources(databaseOf(WORLD), {
      organizationId: 'org',
      sources: [{ projectId: 'tale' }],
      authorityUserId: null,
    });
    expect(judged.map((source) => source.skipped)).toEqual(['no_authority']);
    expect(memberEditableProjects).not.toHaveBeenCalled();
  });

  it('lets a dispatch act on a source only while it reaches it', async () => {
    adaEdits('tale');
    const sql = databaseOf(WORLD);
    const reaches = (projectId: string) =>
      dispatchReachesSource(sql, {
        organizationId: 'org',
        dispatchProjectId: 'development',
        projectId,
      });
    expect(await reaches('tale')).toBe(true);
    expect(await reaches('billing')).toBe(false);
    // A project the dispatch does not list is no source of it.
    expect(await reaches('elsewhere')).toBe(false);
  });
});

describe('the agents of a dispatch work the boards it serves like their own [TASK-R73]', () => {
  it('puts its pool, its standing roles’ agents and its reviewers beyond its board, nobody else', () => {
    expect([...dispatchReachAgents(DEVELOPMENT)].sort()).toEqual([
      'coder',
      'manager',
      'reviewer',
    ]);
  });

  it('reaches the sources it may reach for its pool, roles and reviewers', async () => {
    adaEdits('tale', 'billing');
    const sql = databaseOf(WORLD);
    for (const agentId of ['coder', 'reviewer', 'manager']) {
      expect(
        await readAgentReach(sql, { organizationId: 'org', agentId }),
      ).toEqual({
        homeProjectId: 'development',
        reachedProjectIds: ['tale', 'billing'],
      });
    }
    expect(
      await readAgentReach(sql, { organizationId: 'org', agentId: 'reporter' }),
    ).toEqual({ homeProjectId: 'development', reachedProjectIds: [] });
    expect(
      await readAgentReach(sql, { organizationId: 'org', agentId: 'ghost' }),
    ).toBeNull();
  });

  it('answers an agent’s own project without reading any dispatch', async () => {
    const sql = vi.fn(databaseOf(WORLD));
    expect(
      await agentReachesProject(sql as unknown as Sql, {
        organizationId: 'org',
        agentId: 'tale-agent',
        projectId: 'tale',
      }),
    ).toBe(true);
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it('reaches another board only through its own project’s dispatch, while it may', async () => {
    adaEdits('tale');
    const sql = databaseOf(WORLD);
    const reaches = (agentId: string, projectId: string) =>
      agentReachesProject(sql, { organizationId: 'org', agentId, projectId });
    expect(await reaches('coder', 'tale')).toBe(true);
    // Ada lost her right on Billing: nobody's reaches it.
    expect(await reaches('coder', 'billing')).toBe(false);
    // Outside the dispatch, an agent reaches only its own project.
    expect(await reaches('reporter', 'tale')).toBe(false);
    // Serving is one way: Tale's agent does not reach Development.
    expect(await reaches('tale-agent', 'development')).toBe(false);
  });

  it('reaches nothing beyond an archived project, or through a dispatch this version cannot read', async () => {
    adaEdits('tale', 'billing');
    expect(
      await readAgentReach(
        databaseOf({
          ...WORLD,
          agents: { coder: { projectId: 'development', archived: true } },
        }),
        { organizationId: 'org', agentId: 'coder' },
      ),
    ).toEqual({ homeProjectId: 'development', reachedProjectIds: [] });
    expect(
      await readAgentReach(
        databaseOf({
          ...WORLD,
          dispatches: {
            development: { config: 'unreadable', updatedBy: 'ada' },
          },
        }),
        { organizationId: 'org', agentId: 'coder' },
      ),
    ).toEqual({ homeProjectId: 'development', reachedProjectIds: [] });
  });

  it('lets a run’s authority reach its own project and the ones it reaches, nothing else', () => {
    const authority = {
      projectId: 'development',
      reachedProjectIds: ['tale'],
    };
    expect(authorityReaches(authority, 'development')).toBe(true);
    expect(authorityReaches(authority, 'tale')).toBe(true);
    expect(authorityReaches(authority, 'billing')).toBe(false);
    expect(authorityReaches({ projectId: 'tale' }, 'development')).toBe(false);
  });
});

describe('a board says which other projects’ dispatches serve it [TASK-R76]', () => {
  it('names each serving dispatch, switched on or off, served or skipped with why', async () => {
    adaEdits('tale');
    const sql = databaseOf({
      ...WORLD,
      projects: { ...WORLD.projects, support: { name: 'Support' } },
      dispatches: {
        ...WORLD.dispatches,
        support: {
          config: {
            ...DEVELOPMENT,
            enabled: false,
            sources: [{ projectId: 'tale' }],
          },
          updatedBy: 'bea',
        },
      },
    });
    expect(
      await dispatchesServing(sql, {
        organizationId: 'org',
        projectId: 'tale',
      }),
    ).toEqual([
      {
        projectId: 'development',
        name: 'Development',
        enabled: true,
        reachable: true,
        skipped: null,
      },
      {
        projectId: 'support',
        name: 'Support',
        enabled: false,
        reachable: false,
        skipped: 'no_authority',
      },
    ]);
    expect(
      await dispatchesServing(sql, {
        organizationId: 'org',
        projectId: 'development',
      }),
    ).toEqual([]);
  });

  it('names the agents a dispatch puts to work on the board while it reaches it, and none of one that skips it', async () => {
    adaEdits('tale');
    const sql = databaseOf({
      ...WORLD,
      agents: { ...WORLD.agents, helper: { projectId: 'support' } },
      projects: { ...WORLD.projects, support: { name: 'Support' } },
      dispatches: {
        ...WORLD.dispatches,
        support: {
          config: {
            ...DEVELOPMENT,
            agents: ['helper'],
            standingRoles: undefined,
            reviewers: undefined,
            sources: [{ projectId: 'tale' }],
          },
          updatedBy: 'bea',
        },
      },
    });
    expect(
      await agentsServingProject(sql, {
        organizationId: 'org',
        projectId: 'tale',
      }),
    ).toEqual([
      {
        agentId: 'coder',
        name: 'Agent coder',
        tools: [],
        projectId: 'development',
        projectName: 'Development',
      },
      {
        agentId: 'manager',
        name: 'Agent manager',
        tools: [],
        projectId: 'development',
        projectName: 'Development',
      },
      {
        agentId: 'reviewer',
        name: 'Agent reviewer',
        tools: ['task_review'],
        projectId: 'development',
        projectName: 'Development',
      },
    ]);
    // Bea's right on Tale was never there: Support's helper is not put to
    // work on it, and Development's agents work nowhere on their own board.
    expect(
      await agentsServingProject(sql, {
        organizationId: 'org',
        projectId: 'development',
      }),
    ).toEqual([]);
  });
});
