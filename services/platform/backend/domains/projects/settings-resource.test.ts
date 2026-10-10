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

const { agents, projects } = vi.hoisted(() => ({
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
  const cas = (current: unknown, expected: string) => {
    if (configurationHash(current) !== expected) {
      throw new ConfigurationError(
        'CONFIG_VERSION_CONFLICT',
        'Configuration changed since it was reviewed.',
      );
    }
  };
  return {
    ...actual,
    getProjectAuthContext: async (
      _sql: unknown,
      member: { organizationId: string; userId: string; role: string },
    ) => ({ ...member, teamIds: [] }),
    listProjects: async () =>
      [...projects.entries()]
        .filter(([, entry]) => !entry.archived)
        .map(([id]) => ({ id })),
    listProjectAgents: async (
      _sql: unknown,
      _auth: unknown,
      projectId: string,
    ) =>
      [...agents.keys()]
        .filter((key) => key.startsWith(`${projectId}/`))
        .map((key) => ({ id: key.slice(projectId.length + 1) })),
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
  it('pages the instructions of the projects the caller reads, archived ones aside', async () => {
    for (let index = 0; index < 60; index += 1)
      project(`p-${String(index).padStart(2, '0')}`);
    project('p-archived', { archived: true });
    const first = await getSettings(contextOf('member'), registry, {
      kinds: ['project-instructions'],
    });
    expect(first.resources).toHaveLength(50);
    expect(first.nextCursor).toBe('p50');
    const second = await getSettings(contextOf('member'), registry, {
      kinds: ['project-instructions'],
      cursor: 'p50',
    });
    expect(second.resources).toHaveLength(10);
    expect(second.nextCursor).toBe(null);
    expect(JSON.stringify([first, second])).not.toContain('p-archived');
  });

  it("lists every agent's tools by project and agent", async () => {
    project('p-1');
    agent('p-1/a-1', { tools: ['task_find'] });
    agent('p-1/a-2');
    const answer = await getSettings(contextOf('member'), registry, {
      kinds: ['agent-tools'],
    });
    expect(answer.resources).toEqual([
      expect.objectContaining({
        key: 'agent-tools/p-1/a-1',
        config: { projectId: 'p-1', agentId: 'a-1', tools: ['task_find'] },
      }),
      expect.objectContaining({ key: 'agent-tools/p-1/a-2' }),
    ]);
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
