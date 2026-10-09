// @vitest-environment node

/**
 * A task's description over MCP. The writer is the managed lane's own,
 * held against a real schema by `projects/managed-instructions.integration.ts`;
 * here it is an in-memory task with the same hash and refusals.
 */

import { configurationHash } from '@tale/shared/utils/configuration-hash';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { task } = vi.hoisted(() => ({
  task: { description: 'Draft the report.', archived: false, workable: true },
}));

vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: (
    _sql: unknown,
    work: (tx: unknown) => Promise<unknown>,
  ) => work({}),
}));
vi.mock('../projects/service.ts', async (original) => ({
  ...(await original<typeof import('../projects/service.ts')>()),
  getProjectAuthContext: async (
    _sql: unknown,
    member: { organizationId: string; userId: string; role: string },
  ) => ({ ...member, teamIds: [] }),
  loadProjectOrThrow: async (_sql: unknown, id: string) => ({ id }),
}));
vi.mock('./service.ts', async (original) => {
  const actual = await original<typeof import('./service.ts')>();
  const { ConfigurationError } =
    await import('../../core/lib/config_store/precondition');
  const config = () => ({
    projectId: 'p-1',
    taskId: 't-1',
    description: task.description,
  });
  return {
    ...actual,
    loadTaskOrThrow: async () => ({ id: 't-1', projectId: 'p-1' }),
    assertTaskWorkable: async () => {
      if (!task.workable) {
        throw new actual.TaskError(
          'TASK_FORBIDDEN',
          'Not allowed to work on this task',
          403,
        );
      }
    },
    assertTaskNotArchived: () => {
      if (task.archived) {
        throw new actual.TaskError(
          'TASK_ARCHIVED',
          'The task is archived.',
          409,
        );
      }
    },
    readTaskInstructionsConfiguration: async () => ({
      config: config(),
      hash: configurationHash(config()),
    }),
    updateTaskInstructionsConfiguration: vi.fn(
      async (
        _tx: unknown,
        _auth: unknown,
        next: { description: string },
        expected: string,
      ) => {
        if (configurationHash(config()) !== expected) {
          throw new ConfigurationError(
            'CONFIG_VERSION_CONFLICT',
            'Configuration changed since it was reviewed.',
          );
        }
        task.description = next.description;
      },
    ),
  };
});

import type { McpCaller } from '../mcp/caller.ts';
import { applySettings } from '../mcp/settings/apply.ts';
import { getSettings } from '../mcp/settings/get.ts';
import { planSettings } from '../mcp/settings/plan.ts';
import type { SettingsContext } from '../mcp/settings/registry.ts';
import { taskInstructionsSettings } from './settings-resource.ts';

const registry = { 'task-instructions': taskInstructionsSettings };

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

const change = (description: string) => ({
  kind: 'task-instructions' as const,
  op: 'set' as const,
  config: { projectId: 'p-1', taskId: 't-1', description },
});

beforeEach(() => {
  Object.assign(task, {
    description: 'Draft the report.',
    archived: false,
    workable: true,
  });
});

describe("a task's description over MCP", () => {
  it('reads the tasks a call names, and asks for ids rather than reading every task', async () => {
    const all = await getSettings(contextOf('member'), registry, {
      kinds: ['task-instructions'],
    });
    expect(all.refused).toEqual([
      expect.objectContaining({
        code: 'SETTINGS_IDS_REQUIRED',
        hint: expect.stringContaining('<projectId>/<taskId>'),
      }),
    ]);
    const named = await getSettings(contextOf('member'), registry, {
      kinds: ['task-instructions'],
      ids: ['p-1/t-1'],
    });
    expect(named.resources).toEqual([
      expect.objectContaining({
        key: 'task-instructions/p-1/t-1',
        config: {
          projectId: 'p-1',
          taskId: 't-1',
          description: 'Draft the report.',
        },
      }),
    ]);
  });

  it("refuses what the task's own rules refuse, before anything is written [MCP-R10]", async () => {
    task.archived = true;
    const archived = await planSettings(contextOf('member'), registry, [
      change('Draft it by Friday.'),
    ]);
    expect(archived.changes[0]?.refusal?.code).toBe('TASK_ARCHIVED');
    task.archived = false;
    task.workable = false;
    const forbidden = await planSettings(contextOf('member'), registry, [
      change('Draft it by Friday.'),
    ]);
    expect(forbidden.changes[0]?.refusal?.code).toBe('TASK_FORBIDDEN');
  });

  it('changes the description through the managed writer, only as it was read', async () => {
    const read = configurationHash({
      projectId: 'p-1',
      taskId: 't-1',
      description: 'Draft the report.',
    });
    const applied = await applySettings(
      contextOf('member'),
      registry,
      [change('Draft it by Friday.')],
      { 'task-instructions/p-1/t-1': read },
    );
    expect(applied).toMatchObject({ applied: [{ action: 'update' }] });
    expect(task.description).toBe('Draft it by Friday.');
    const stale = await applySettings(
      contextOf('member'),
      registry,
      [change('Draft it by Monday.')],
      { 'task-instructions/p-1/t-1': read },
    );
    expect(stale).toMatchObject({ code: 'SETTINGS_STALE' });
  });
});
