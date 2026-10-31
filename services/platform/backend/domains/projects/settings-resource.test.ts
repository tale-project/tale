// @vitest-environment node

/**
 * A project's instructions and its agents' instructions, tools and model
 * over MCP. The writers are the managed lane's own, held against a real schema
 * by `managed-instructions.integration.ts` and `managed-tools.integration.ts`;
 * here they are an in-memory store with the same hash and refusals, so
 * what the kinds add — ids, listing, plan gates and compare-and-set — is
 * what is tested.
 */

import { configurationHash } from '@tale/shared/utils/configuration-hash';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { agents, projects, uncallable } = vi.hoisted(() => ({
  /** Models the organization cannot call, as its serving listing says. */
  uncallable: new Set<string>(),
  projects: new Map<
    string,
    { instructions: string; archived: boolean; editable: boolean }
  >(),
  agents: new Map<
    string,
    {
      instructions: string;
      tools: string[];
      managed: boolean;
      harness: string;
      model: string;
      modelProvider: string;
    }
  >(),
}));

vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: (
    _sql: unknown,
    work: (tx: unknown) => Promise<unknown>,
  ) => work({}),
}));
vi.mock('./service.ts', async (original) => {
  const actual = await original<typeof import('./service.ts')>();
  const { ConfigurationError } =
    await import('../../core/lib/config_store/precondition');
  const snapshot = <T>(config: T) => ({
    config,
    hash: configurationHash(config),
  });
  const projectOf = (id: string) => {
    const found = projects.get(id);
    if (found === undefined) {
      throw new actual.ProjectError(
        'PROJECT_NOT_FOUND',
        'Project not found',
        404,
      );
    }
    return { id, ...found };
  };
  const agentOf = (projectId: string, agentId: string) => {
    projectOf(projectId);
    const found = agents.get(`${projectId}/${agentId}`);
    if (found === undefined) {
      throw new actual.ProjectError(
        'PROJECT_AGENT_NOT_FOUND',
        'Agent not found',
        404,
      );
    }
    return found;
  };
  /** The model check the writer makes: a model the organization cannot
   * call is refused, as the serving listing refuses it. */
  const checkModel = (config: { model: string }) => {
    if (uncallable.has(config.model)) {
      throw new actual.ProjectError(
        'PROJECT_AGENT_MODEL_INVALID',
        `Model "${config.model}" is not available to this organization.`,
      );
    }
  };
  const cas = (current: unknown, expected: string) => {
    if (configurationHash(current) !== expected) {
      throw new ConfigurationError(
        'CONFIG_VERSION_CONFLICT',
        'Configuration changed since it was reviewed.',
      );
    }
  };
  /** The store's keyset: newest first, up to `limit` rows after `cursor`,
   * and whether more follow. A row is as new as its place in its map, so
   * the latest one put is the newest. */
  const keysetPage = <T extends { id: string; createdAt: number }>(
    rows: T[],
    options: { limit: number; cursor: { at: number; id: string } | null },
  ) => {
    const after = options.cursor;
    const rest = rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter(
        (row) =>
          after === null ||
          row.createdAt < after.at ||
          (row.createdAt === after.at && row.id < after.id),
      );
    return {
      rows: rest.slice(0, options.limit),
      hasMore: rest.length > options.limit,
    };
  };
  return {
    ...actual,
    checkAgentModelConfiguration: async (
      _sql: unknown,
      _auth: unknown,
      _agent: unknown,
      config: { model: string },
    ) => checkModel(config),
    getProjectAuthContext: async (
      _sql: unknown,
      member: { organizationId: string; userId: string; role: string },
    ) => ({ ...member, teamIds: [] }),
    listProjectsPage: async (
      _sql: unknown,
      _auth: unknown,
      options: {
        archived: 'exclude' | 'include' | 'only';
        limit: number;
        cursor: { at: number; id: string } | null;
      },
    ) => {
      const page = keysetPage(
        [...projects.entries()]
          // oxlint-disable-next-line oxc/no-map-spread -- copies: the test's own entries stay as it put them
          .map(([id, entry], index) => ({ id, ...entry, createdAt: index }))
          .filter(
            (entry) =>
              options.archived === 'include' ||
              (options.archived === 'only') === entry.archived,
          ),
        options,
      );
      return { projects: page.rows, hasMore: page.hasMore };
    },
    // The agents of the projects the caller reads that are not archived.
    listReadableProjectAgentsPage: async (
      _sql: unknown,
      _auth: unknown,
      options: { limit: number; cursor: { at: number; id: string } | null },
    ) => {
      const page = keysetPage(
        [...agents.entries()]
          // oxlint-disable-next-line oxc/no-map-spread -- copies: the test's own entries stay as it put them
          .map(([key, entry], index) => {
            const [projectId = '', id = ''] = key.split('/');
            return { id, projectId, ...entry, createdAt: index };
          })
          .filter((entry) => projects.get(entry.projectId)?.archived === false),
        options,
      );
      return { agents: page.rows, hasMore: page.hasMore };
    },
    loadProjectOrThrow: async (_sql: unknown, id: string) => projectOf(id),
    assertWritable: (entry: { editable: boolean }) => {
      if (!entry.editable) {
        throw new actual.ProjectError(
          'RBAC_FORBIDDEN',
          'Editor role required',
          403,
        );
      }
    },
    assertProjectActive: (entry: { archived: boolean }) => {
      if (entry.archived) {
        throw new actual.ProjectError(
          'PROJECT_ARCHIVED',
          'The project is archived; restore it first.',
          409,
        );
      }
    },
    getProjectAgent: async (
      _sql: unknown,
      _auth: unknown,
      projectId: string,
      agentId: string,
    ) => agentOf(projectId, agentId),
    readProjectInstructionsConfiguration: async (
      _sql: unknown,
      _auth: unknown,
      projectId: string,
    ) =>
      snapshot({ projectId, instructions: projectOf(projectId).instructions }),
    readAgentInstructionsConfiguration: async (
      _sql: unknown,
      _auth: unknown,
      projectId: string,
      agentId: string,
    ) =>
      snapshot({
        projectId,
        agentId,
        instructions: agentOf(projectId, agentId).instructions,
      }),
    readAgentToolsConfiguration: async (
      _sql: unknown,
      _auth: unknown,
      projectId: string,
      agentId: string,
    ) =>
      snapshot({
        projectId,
        agentId,
        tools: agentOf(projectId, agentId).tools,
      }),
    readAgentModelConfiguration: async (
      _sql: unknown,
      _auth: unknown,
      projectId: string,
      agentId: string,
    ) => {
      const { harness, model, modelProvider } = agentOf(projectId, agentId);
      return snapshot({ projectId, agentId, harness, model, modelProvider });
    },
    updateProjectInstructions: vi.fn(
      async (
        _tx: unknown,
        _auth: unknown,
        projectId: string,
        instructions: string,
        expected: string,
      ) => {
        const entry = projectOf(projectId);
        cas({ projectId, instructions: entry.instructions }, expected);
        projects.set(projectId, { ...entry, instructions });
      },
    ),
    updateAgentInstructionsConfiguration: vi.fn(
      async (
        _tx: unknown,
        _auth: unknown,
        config: { projectId: string; agentId: string; instructions: string },
        expected: string,
      ) => {
        const entry = agentOf(config.projectId, config.agentId);
        cas(
          {
            projectId: config.projectId,
            agentId: config.agentId,
            instructions: entry.instructions,
          },
          expected,
        );
        agents.set(`${config.projectId}/${config.agentId}`, {
          ...entry,
          instructions: config.instructions,
        });
      },
    ),
    updateAgentToolsConfiguration: vi.fn(
      async (
        _tx: unknown,
        _auth: unknown,
        config: { projectId: string; agentId: string; tools: string[] },
        expected: string,
      ) => {
        const entry = agentOf(config.projectId, config.agentId);
        cas(
          {
            projectId: config.projectId,
            agentId: config.agentId,
            tools: entry.tools,
          },
          expected,
        );
        agents.set(`${config.projectId}/${config.agentId}`, {
          ...entry,
          tools: config.tools,
        });
      },
    ),
    updateAgentModelConfiguration: vi.fn(
      async (
        _tx: unknown,
        _auth: unknown,
        config: {
          projectId: string;
          agentId: string;
          harness: string;
          model: string;
          modelProvider: string;
        },
        expected: string,
      ) => {
        const entry = agentOf(config.projectId, config.agentId);
        cas(
          {
            projectId: config.projectId,
            agentId: config.agentId,
            harness: entry.harness,
            model: entry.model,
            modelProvider: entry.modelProvider,
          },
          expected,
        );
        checkModel(config);
        agents.set(`${config.projectId}/${config.agentId}`, {
          ...entry,
          harness: config.harness,
          model: config.model,
          modelProvider: config.modelProvider,
        });
      },
    ),
  };
});

import type { McpCaller } from '../mcp/caller.ts';
import { applySettings } from '../mcp/settings/apply.ts';
import { getSettings } from '../mcp/settings/get.ts';
import { planSettings } from '../mcp/settings/plan.ts';
import type { SettingsContext } from '../mcp/settings/registry.ts';
import {
  updateAgentModelConfiguration,
  updateAgentToolsConfiguration,
} from './service.ts';
import {
  agentInstructionsSettings,
  agentModelSettings,
  agentToolsSettings,
  projectInstructionsSettings,
} from './settings-resource.ts';

const registry = {
  'project-instructions': projectInstructionsSettings,
  'agent-instructions': agentInstructionsSettings,
  'agent-tools': agentToolsSettings,
  'agent-model': agentModelSettings,
};

function contextOf(role: string): SettingsContext {
  const caller: McpCaller = {
    organizationId: 'org-1',
    orgSlug: 'acme',
    userId: `user-${role}`,
    role,
    credential: { kind: 'api-key', apiKeyId: 'key-laptop' },
  };
  const tag = async () => [{ email: `${role}@example.test` }];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, caller };
}

function project(
  id: string,
  fields: Partial<{
    instructions: string;
    archived: boolean;
    editable: boolean;
  }> = {},
) {
  projects.set(id, {
    instructions: '',
    archived: false,
    editable: true,
    ...fields,
  });
}

function agent(
  key: string,
  fields: Partial<{
    instructions: string;
    tools: string[];
    managed: boolean;
    model: string;
  }> = {},
) {
  agents.set(key, {
    instructions: '',
    tools: [],
    managed: false,
    harness: 'claude-code',
    model: 'model-a',
    modelProvider: 'provider-a',
    ...fields,
  });
}

beforeEach(() => {
  projects.clear();
  agents.clear();
  uncallable.clear();
  vi.clearAllMocks();
});

describe('who reads and changes project settings [MCP-R10]', () => {
  it('lets every member read and an editor change, as the access matrix says', async () => {
    expect(
      await projectInstructionsSettings.access(contextOf('member')),
    ).toEqual({ read: true, write: false });
    for (const role of ['editor', 'developer', 'admin']) {
      expect(await agentToolsSettings.access(contextOf(role))).toEqual({
        read: true,
        write: true,
      });
    }
  });

  it("refuses a change the project's own rules refuse, before anything is written", async () => {
    project('p-read', { editable: false });
    project('p-old', { archived: true });
    agent('p-ok/a-managed', { managed: true });
    project('p-ok');
    const plan = await planSettings(contextOf('editor'), registry, [
      {
        kind: 'project-instructions',
        op: 'set',
        config: { projectId: 'p-read', instructions: 'Be brief.' },
      },
      {
        kind: 'project-instructions',
        op: 'set',
        config: { projectId: 'p-old', instructions: 'Be brief.' },
      },
      {
        kind: 'agent-instructions',
        op: 'set',
        config: {
          projectId: 'p-ok',
          agentId: 'a-managed',
          instructions: 'Be brief.',
        },
      },
    ]);
    expect(plan.changes.map((change) => change.refusal?.code)).toEqual([
      'RBAC_FORBIDDEN',
      'PROJECT_ARCHIVED',
      'PROJECT_AGENT_MANAGED',
    ]);
  });
});

describe('reading project settings', () => {
  it('pages the instructions of the projects the caller reads, newest first, archived ones aside', async () => {
    for (let index = 0; index < 60; index += 1)
      project(`p-${String(index).padStart(2, '0')}`);
    project('p-archived', { archived: true });
    const first = await getSettings(contextOf('member'), registry, {
      kinds: ['project-instructions'],
    });
    expect(first.resources).toHaveLength(50);
    expect(first.nextCursor).toMatch(/^project-instructions:./);
    const second = await getSettings(contextOf('member'), registry, {
      kinds: ['project-instructions'],
      cursor: first.nextCursor as string,
    });
    expect(second.resources).toHaveLength(10);
    expect(second.nextCursor).toBe(null);
    const resources = [first, second].flatMap(
      (page) => page.resources as Array<{ id: string }>,
    );
    expect(resources.map((resource) => resource.id)).toEqual(
      Array.from(
        { length: 60 },
        (_, index) => `p-${String(59 - index).padStart(2, '0')}`,
      ),
    );
    expect(JSON.stringify([first, second])).not.toContain('p-archived');
  });

  it('refuses the offset cursor the listing answered before it paged on a keyset', async () => {
    project('p-1');
    const answer = await getSettings(contextOf('member'), registry, {
      kinds: ['project-instructions'],
      cursor: 'project-instructions:p50',
    });
    expect(answer.resources).toEqual([]);
    expect(answer.refused).toEqual([
      expect.objectContaining({
        kind: 'project-instructions',
        code: 'INVALID_CURSOR',
      }),
    ]);
  });

  it('cuts a page of instructions once they take the room an answer has, and walks every project once [MCP-R35]', async () => {
    // Twenty-five projects with the longest instructions a project may hold:
    // fifty to a page would be a megabyte, past what get_settings answers.
    for (let index = 0; index < 25; index += 1) {
      project(`p-${String(index).padStart(2, '0')}`, {
        instructions: 'x'.repeat(20_000),
      });
    }
    const ids: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await getSettings(contextOf('member'), registry, {
        kinds: ['project-instructions'],
        ...(cursor === undefined ? {} : { cursor }),
      });
      const resources = page.resources as Array<{ id: string }>;
      sizes.push(JSON.stringify(page).length);
      ids.push(...resources.map((resource) => resource.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor as string;
    }
    expect(ids).toEqual(
      Array.from(
        { length: 25 },
        (_, index) => `p-${String(24 - index).padStart(2, '0')}`,
      ),
    );
    expect(sizes.length).toBeGreaterThan(1);
    // Under the 250,000 characters get_settings advertises.
    expect(Math.max(...sizes)).toBeLessThan(250_000);
  });

  it('pages the agents of every project the caller reads, newest first, and cuts a page when they take the room [MCP-R35]', async () => {
    project('p-1');
    project('p-2');
    for (let index = 0; index < 15; index += 1) {
      agent(`p-1/a-${String(index).padStart(2, '0')}`, {
        instructions: 'x'.repeat(20_000),
      });
    }
    agent('p-2/a-00', { instructions: 'short' });
    const keys: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await getSettings(contextOf('member'), registry, {
        kinds: ['agent-instructions'],
        ...(cursor === undefined ? {} : { cursor }),
      });
      const resources = page.resources as Array<{ key: string }>;
      keys.push(...resources.map((resource) => resource.key));
      pageSizes.push(resources.length);
      if (page.nextCursor === null) break;
      cursor = page.nextCursor as string;
    }
    // Every agent of every project the caller reads, once and newest first,
    // over more than one page: the first cut among p-1's agents.
    expect(keys).toEqual([
      'agent-instructions/p-2/a-00',
      ...Array.from(
        { length: 15 },
        (_, index) =>
          `agent-instructions/p-1/a-${String(14 - index).padStart(2, '0')}`,
      ),
    ]);
    expect(pageSizes.length).toBeGreaterThan(1);
    expect(pageSizes[0]).toBeLessThan(16);
  });

  it("lists every agent's tools, newest agent first", async () => {
    project('p-1');
    agent('p-1/a-1', { tools: ['task_find'] });
    agent('p-1/a-2');
    const answer = await getSettings(contextOf('member'), registry, {
      kinds: ['agent-tools'],
    });
    expect(answer.resources).toEqual([
      expect.objectContaining({ key: 'agent-tools/p-1/a-2' }),
      expect.objectContaining({
        key: 'agent-tools/p-1/a-1',
        config: { projectId: 'p-1', agentId: 'a-1', tools: ['task_find'] },
      }),
    ]);
  });

  it('lists each resource with the config and hash its own read answers, so a listed hash sets it', async () => {
    project('p-1', { instructions: 'Be brief.' });
    agent('p-1/a-1', {
      instructions: 'Answer in English.',
      tools: ['task_find'],
      model: 'model-b',
    });
    for (const [kind, id] of [
      ['project-instructions', 'p-1'],
      ['agent-instructions', 'p-1/a-1'],
      ['agent-tools', 'p-1/a-1'],
      ['agent-model', 'p-1/a-1'],
    ] as const) {
      const listed = await getSettings(contextOf('member'), registry, {
        kinds: [kind],
      });
      const read = await getSettings(contextOf('member'), registry, {
        kinds: [kind],
        ids: [id],
      });
      expect(read.resources).toEqual([
        expect.objectContaining({
          key: `${kind}/${id}`,
          hash: expect.any(String),
        }),
      ]);
      expect(listed.resources).toEqual(read.resources);
    }
  });
});

describe('changing project settings', () => {
  it('names the resource by the ids its config carries, and refuses a config another than its id', async () => {
    project('p-1');
    const plan = await planSettings(contextOf('editor'), registry, [
      {
        kind: 'project-instructions',
        id: 'p-2',
        op: 'set',
        config: { projectId: 'p-1', instructions: 'Be brief.' },
      },
      {
        kind: 'agent-instructions',
        id: 'p-1',
        op: 'set',
        config: { projectId: 'p-1', agentId: 'a-1', instructions: 'x' },
      },
      {
        kind: 'project-instructions',
        op: 'set',
        config: { projectId: 'p-1', instructions: 'Be brief.', tone: 'dry' },
      },
    ]);
    expect(plan.changes.map((change) => change.refusal?.code)).toEqual([
      'SETTINGS_ID_INVALID',
      'SETTINGS_ID_INVALID',
      'SETTINGS_INVALID',
    ]);
  });

  it('applies through the managed writer, compare-and-set on the hash read', async () => {
    project('p-1', { instructions: 'Old.' });
    const [read] = (
      await getSettings(contextOf('editor'), registry, {
        kinds: ['project-instructions'],
        ids: ['p-1'],
      })
    ).resources as Array<{ hash: string }>;
    const change = {
      kind: 'project-instructions' as const,
      op: 'set' as const,
      config: { projectId: 'p-1', instructions: 'Be brief.' },
    };
    const plan = await planSettings(contextOf('editor'), registry, [change]);
    expect(plan.changes[0]).toMatchObject({
      key: 'project-instructions/p-1',
      action: 'update',
      diff: [{ path: '/instructions', before: 'Old.', after: 'Be brief.' }],
      risk: 'high',
    });
    const answer = await applySettings(
      contextOf('editor'),
      registry,
      [change],
      {
        'project-instructions/p-1': read?.hash ?? null,
      },
    );
    expect(answer).toMatchObject({
      applied: [
        {
          action: 'update',
          hash: configurationHash({
            projectId: 'p-1',
            instructions: 'Be brief.',
          }),
        },
      ],
    });
    const stale = await applySettings(
      contextOf('editor'),
      registry,
      [{ ...change, config: { projectId: 'p-1', instructions: 'Later.' } }],
      { 'project-instructions/p-1': read?.hash ?? null },
    );
    expect(stale).toMatchObject({ code: 'SETTINGS_STALE', applied: [] });
  });

  it("grants an agent only tools the catalog has, in the catalog's order", async () => {
    project('p-1');
    agent('p-1/a-1');
    const hash = configurationHash({
      projectId: 'p-1',
      agentId: 'a-1',
      tools: [],
    });
    const refused = await planSettings(contextOf('editor'), registry, [
      {
        kind: 'agent-tools',
        op: 'set',
        config: { projectId: 'p-1', agentId: 'a-1', tools: ['shell_exec'] },
      },
    ]);
    expect(refused.changes[0]?.refusal?.code).toBe('SETTINGS_INVALID');
    await applySettings(
      contextOf('editor'),
      registry,
      [
        {
          kind: 'agent-tools',
          op: 'set',
          config: {
            projectId: 'p-1',
            agentId: 'a-1',
            tools: ['task_get', 'task_find'],
          },
        },
      ],
      { 'agent-tools/p-1/a-1': hash },
    );
    expect(updateAgentToolsConfiguration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-editor' }),
      { projectId: 'p-1', agentId: 'a-1', tools: ['task_find', 'task_get'] },
      hash,
    );
  });

  it('changes the model an agent runs on through its writer, compare-and-set on the hash read', async () => {
    project('p-1');
    agent('p-1/a-1');
    const before = {
      projectId: 'p-1',
      agentId: 'a-1',
      harness: 'claude-code',
      model: 'model-a',
      modelProvider: 'provider-a',
    };
    const change = {
      kind: 'agent-model' as const,
      op: 'set' as const,
      config: { ...before, model: 'model-b' },
    };
    const plan = await planSettings(contextOf('editor'), registry, [change]);
    expect(plan.changes[0]).toMatchObject({
      key: 'agent-model/p-1/a-1',
      action: 'update',
      diff: [{ path: '/model', before: 'model-a', after: 'model-b' }],
    });
    const answer = await applySettings(
      contextOf('editor'),
      registry,
      [change],
      { 'agent-model/p-1/a-1': configurationHash(before) },
    );
    expect(answer).toMatchObject({
      applied: [{ action: 'update', hash: configurationHash(change.config) }],
    });
    expect(updateAgentModelConfiguration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-editor' }),
      change.config,
      configurationHash(before),
    );
  });

  it('refuses a model change on an agent Tale manages, before anything is written', async () => {
    project('p-1');
    agent('p-1/a-1', { managed: true });
    const plan = await planSettings(contextOf('editor'), registry, [
      {
        kind: 'agent-model',
        op: 'set',
        config: {
          projectId: 'p-1',
          agentId: 'a-1',
          harness: 'claude-code',
          model: 'model-b',
          modelProvider: 'provider-a',
        },
      },
    ]);
    expect(plan.changes[0]?.refusal?.code).toBe('PROJECT_AGENT_MANAGED');
    expect(updateAgentModelConfiguration).not.toHaveBeenCalled();
  });
});

describe('what the agent model writer refuses, planned before anything is applied [MCP-R11]', () => {
  const before = {
    projectId: 'p-1',
    agentId: 'a-1',
    harness: 'claude-code',
    model: 'model-a',
    modelProvider: 'provider-a',
  };

  it('refuses a model the organization cannot call, and applies nothing else of the call', async () => {
    project('p-1');
    agent('p-1/a-1');
    uncallable.add('model-x');
    const changes = [
      {
        kind: 'project-instructions' as const,
        op: 'set' as const,
        config: { projectId: 'p-1', instructions: 'Answer in one line.' },
      },
      {
        kind: 'agent-model' as const,
        op: 'set' as const,
        config: { ...before, model: 'model-x' },
      },
    ];
    const plan = await planSettings(contextOf('editor'), registry, changes);
    expect(plan.changes[1]?.refusal).toMatchObject({
      code: 'PROJECT_AGENT_MODEL_INVALID',
    });
    const instructions = projects.get('p-1')?.instructions;
    const answer = await applySettings(contextOf('editor'), registry, changes, {
      'project-instructions/p-1': configurationHash({
        projectId: 'p-1',
        instructions,
      }),
      'agent-model/p-1/a-1': configurationHash(before),
    });
    expect(answer).toMatchObject({
      code: 'PROJECT_AGENT_MODEL_INVALID',
      applied: [],
    });
    expect(projects.get('p-1')?.instructions).toBe(instructions);
  });

  it('names a change of the model as one that changes what serves the agent', async () => {
    project('p-1');
    agent('p-1/a-1');
    const plan = await planSettings(contextOf('editor'), registry, [
      {
        kind: 'agent-model',
        op: 'set',
        config: { ...before, modelProvider: 'provider-b' },
      },
    ]);
    expect(plan.changes[0]).toMatchObject({
      action: 'update',
      effects: ['changes-serving-account'],
      risk: 'high',
    });
  });
});
