// @vitest-environment node

/**
 * A task's description and its review context over MCP. The writers are
 * the managed lane's own, held against a real schema by
 * `projects/managed-instructions.integration.ts` and the review-context
 * lanes; here they are an in-memory task with the same hash and refusals.
 */

import { configurationHash } from '@tale/shared/utils/configuration-hash';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { task, review } = vi.hoisted(() => ({
  task: {
    description: 'Draft the report.',
    archived: false,
    workable: true,
    /** A mention the task's own rules refuse, when its description names it. */
    unmentionable: null as string | null,
  },
  review: {
    context: null as null | {
      projectId: string;
      taskId: string;
      reviewerAgentId: string;
      enabled: boolean;
    },
    editor: true,
    /** Whether the task has run, been reviewed or has children. */
    history: false,
    /** The reviewer agent's tools; null when the project has no such agent. */
    reviewerTools: ['task_review'] as string[] | null,
  },
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
vi.mock('../../core/projects/access.ts', async (original) => ({
  ...(await original<typeof import('../../core/projects/access.ts')>()),
  checkProjectAccess: () => ({ canRead: true, canEdit: review.editor }),
}));
vi.mock('./review-context.ts', async (original) => {
  const { ConfigurationError } =
    await import('../../core/lib/config_store/precondition');
  return {
    ...(await original<typeof import('./review-context.ts')>()),
    readTaskReviewContextConfiguration: async () => ({
      config: review.context,
      hash: configurationHash(review.context),
    }),
    updateTaskReviewContextConfiguration: vi.fn(
      async (
        _tx: unknown,
        _auth: unknown,
        next: NonNullable<typeof review.context>,
        expected: string,
      ) => {
        if (configurationHash(review.context) !== expected) {
          throw new ConfigurationError(
            'CONFIG_VERSION_CONFLICT',
            'Configuration changed since it was reviewed.',
          );
        }
        review.context = next;
      },
    ),
  };
});
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
    // A new operational task, as one is enrolled for a review.
    loadTaskOrThrow: async () => ({
      id: 't-1',
      organizationId: 'org-1',
      projectId: 'p-1',
      status: 'todo',
      externalSystem: null,
      externalId: null,
      externalUrl: null,
      parentTaskId: null,
      repeat: null,
      repeatContinued: false,
      repeatNextTaskId: null,
      completedAt: null,
      attachments: null,
      outputs: null,
      threadId: null,
      sourceDiscussionThreadId: null,
      assigneeId: null,
      assigneeType: null,
      description: task.description,
    }),
    assertTaskDescriptionMentions: async (
      _db: unknown,
      _auth: unknown,
      _task: unknown,
      _projectId: string,
      description: string,
    ) => {
      if (
        task.unmentionable !== null &&
        description.includes(task.unmentionable)
      ) {
        throw new actual.TaskError(
          'TASK_MENTION_INVALID',
          'The description mentions someone who cannot be mentioned on this task.',
          400,
        );
      }
    },
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
import { updateTaskReviewContextConfiguration } from './review-context.ts';
import {
  taskInstructionsSettings,
  taskReviewContextSettings,
} from './settings-resource.ts';

const registry = {
  'task-instructions': taskInstructionsSettings,
  'task-review-context': taskReviewContextSettings,
};

function contextOf(role: string): SettingsContext {
  const caller: McpCaller = {
    organizationId: 'org-1',
    orgSlug: 'acme',
    userId: `user-${role}`,
    role,
    credential: { kind: 'api-key', apiKeyId: 'key-laptop' },
  };
  // The reads the review context's own checks make, and the caller's
  // address for everything else.
  const tag = async (strings: TemplateStringsArray) => {
    const text = strings.join('?');
    if (text.includes('AS present')) return [{ present: review.history }];
    if (text.includes('SELECT tools FROM app.project_agents')) {
      return review.reviewerTools === null
        ? []
        : [{ tools: review.reviewerTools }];
    }
    return [{ email: `${role}@example.test` }];
  };
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
    unmentionable: null,
  });
  Object.assign(review, {
    context: null,
    editor: true,
    history: false,
    reviewerTools: ['task_review'],
  });
  vi.clearAllMocks();
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

describe("a task's review context over MCP", () => {
  const context = {
    projectId: 'p-1',
    taskId: 't-1',
    reviewerAgentId: 'reviewer',
    enabled: true,
  };

  it('reads a named task without one as null, with the hash a change that adds one names', async () => {
    const named = await getSettings(contextOf('member'), registry, {
      kinds: ['task-review-context'],
      ids: ['p-1/t-1'],
    });
    expect(named.resources).toEqual([
      expect.objectContaining({
        key: 'task-review-context/p-1/t-1',
        config: null,
        hash: configurationHash(null),
      }),
    ]);
  });

  it('adds one through its writer, compare-and-set on the hash read', async () => {
    const addition = {
      kind: 'task-review-context' as const,
      op: 'set' as const,
      config: context,
    };
    const answer = await applySettings(
      contextOf('editor'),
      registry,
      [addition],
      {
        'task-review-context/p-1/t-1': configurationHash(null),
      },
    );
    expect(answer).toMatchObject({
      applied: [{ hash: configurationHash(context) }],
    });
    expect(updateTaskReviewContextConfiguration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-editor' }),
      context,
      configurationHash(null),
    );
    const stale = await applySettings(
      contextOf('editor'),
      registry,
      [{ ...addition, config: { ...context, enabled: false } }],
      { 'task-review-context/p-1/t-1': configurationHash(null) },
    );
    expect(stale).toMatchObject({ code: 'SETTINGS_STALE', applied: [] });
  });

  it("refuses a change without the project's editor role, before anything is written", async () => {
    review.editor = false;
    const plan = await planSettings(contextOf('member'), registry, [
      { kind: 'task-review-context', op: 'set', config: context },
    ]);
    expect(plan.changes[0]?.refusal?.code).toBe('RBAC_FORBIDDEN');
    expect(updateTaskReviewContextConfiguration).not.toHaveBeenCalled();
  });
});

describe("what a task's writers refuse, planned before anything is applied [MCP-R11]", () => {
  const context = {
    projectId: 'p-1',
    taskId: 't-1',
    reviewerAgentId: 'reviewer',
    enabled: true,
  };
  const set = (config: typeof context) => ({
    kind: 'task-review-context' as const,
    op: 'set' as const,
    config,
  });
  const refusalOf = async (config: typeof context) =>
    (await planSettings(contextOf('editor'), registry, [set(config)]))
      .changes[0]?.refusal?.code;

  it('refuses another reviewer for an enrolled task, a task with history, a reviewer that cannot review, and an archived task', async () => {
    review.context = context;
    expect(await refusalOf({ ...context, reviewerAgentId: 'other' })).toBe(
      'TASK_REVIEW_INVALID',
    );
    // Enabled or not, the reviewer it was enrolled with may stay.
    expect(await refusalOf({ ...context, enabled: false })).toBeUndefined();
    review.context = null;
    review.history = true;
    expect(await refusalOf(context)).toBe('TASK_REVIEW_INVALID');
    review.history = false;
    review.reviewerTools = [];
    expect(await refusalOf(context)).toBe('TASK_REVIEW_FORBIDDEN');
    review.reviewerTools = null;
    expect(await refusalOf(context)).toBe('TASK_REVIEW_FORBIDDEN');
    review.reviewerTools = ['task_review'];
    task.archived = true;
    expect(await refusalOf(context)).toBe('TASK_ARCHIVED');
    expect(updateTaskReviewContextConfiguration).not.toHaveBeenCalled();
  });

  it('refuses a description that mentions someone the task cannot mention', async () => {
    task.unmentionable = '@[Outsider]';
    const plan = await planSettings(contextOf('member'), registry, [
      change('Ask @[Outsider] to check it.'),
    ]);
    expect(plan.changes[0]?.refusal?.code).toBe('TASK_MENTION_INVALID');
  });
});
