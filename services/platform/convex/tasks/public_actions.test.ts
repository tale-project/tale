import { describe, expect, it, vi } from 'vitest';

import { mergeTaskPullRequest, startTaskWorkflow } from './public_actions';

// Mock-ctx idiom (see external_runs/state_machine.test.ts): the generated server
// wrapper returns its config so `.handler` is callable; api/internal refs become
// string sentinels the fake ctx dispatches on; auth is a no-op.
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, action: (config: Record<string, unknown>) => config };
});

vi.mock('../_generated/api', () => ({
  api: {
    tasks: {
      queries: { getTask: 'getTask' },
      mutations: { updateTaskStatus: 'updateTaskStatus' },
    },
    workflow_executions: {
      actions: { startWorkflowFromFile: 'startWorkflowFromFile' },
    },
  },
  internal: {
    workflow_executions: {
      internal_queries: { getActiveExecutionForSubject: 'getActive' },
    },
    agent_tools: {
      integrations: {
        internal_actions: { executeIntegration: 'executeIntegration' },
      },
    },
  },
}));

vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: vi.fn(async () => ({ userId: 'user_1' })),
}));

// oxlint-disable-next-line typescript/no-explicit-any -- vi.mock narrows to { handler }
type Handler = { handler: (ctx: unknown, args: unknown) => Promise<any> };

const TASK = {
  _id: 'task_1',
  externalId: 'tale-project/tale#1851',
  title: 'a task',
};

function createCtx(opts: {
  task?: unknown;
  active?: unknown;
  startResult?: string | null;
}) {
  const runActionCalls: Array<{ ref: unknown; args: Record<string, unknown> }> =
    [];
  const ctx = {
    runQuery: vi.fn(async (ref: unknown) => {
      if (ref === 'getTask') return opts.task ?? null;
      if (ref === 'getActive') return opts.active ?? null;
      return null;
    }),
    runAction: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      runActionCalls.push({ ref, args });
      return opts.startResult ?? null;
    }),
  };
  return { ctx, runActionCalls };
}

const ARGS = {
  organizationId: 'org_1',
  taskId: 'task_1',
  workflowSlug: 'issue-desk/desk-process',
};

describe('startTaskWorkflow', () => {
  const handler = (startTaskWorkflow as unknown as Handler).handler;

  it('starts a subject-linked run and returns its id', async () => {
    const { ctx, runActionCalls } = createCtx({
      task: { task: TASK },
      active: null,
      startResult: 'exec_new',
    });
    const result = await handler(ctx, ARGS);
    expect(result).toEqual({ started: true, executionId: 'exec_new' });
    expect(runActionCalls).toHaveLength(1);
    expect(runActionCalls[0].ref).toBe('startWorkflowFromFile');
    expect(runActionCalls[0].args.input).toEqual({
      task: TASK,
      issueNumber: 1851,
      owner: 'tale-project',
      repo: 'tale',
    });
    expect(runActionCalls[0].args.subject).toEqual({
      type: 'task',
      id: 'task_1',
    });
  });

  it('throws when the task does not exist', async () => {
    const { ctx } = createCtx({ task: null });
    await expect(handler(ctx, ARGS)).rejects.toThrow('Task not found');
  });

  it('refuses (already_running) when a run is in flight, without starting another', async () => {
    const { ctx, runActionCalls } = createCtx({
      task: { task: TASK },
      active: { executionId: 'exec_old', status: 'running' },
    });
    const result = await handler(ctx, ARGS);
    expect(result).toEqual({
      started: false,
      reason: 'already_running',
      executionId: 'exec_old',
    });
    expect(runActionCalls).toHaveLength(0);
  });

  it('reports not_started when the engine returns null (e.g. uninstalled slug)', async () => {
    const { ctx } = createCtx({
      task: { task: TASK },
      active: null,
      startResult: null,
    });
    const result = await handler(ctx, ARGS);
    expect(result).toEqual({
      started: false,
      reason: 'not_started',
      executionId: null,
    });
  });
});

function createMergeCtx(opts: {
  task?: unknown;
  pulls?: Array<{ number: number; state?: string; merged_at?: string | null }>;
}) {
  const runActionCalls: Array<{ ref: unknown; args: Record<string, unknown> }> =
    [];
  const runMutationCalls: Array<{
    ref: unknown;
    args: Record<string, unknown>;
  }> = [];
  const ctx = {
    runQuery: vi.fn(async (ref: unknown) =>
      ref === 'getTask' ? (opts.task ?? null) : null,
    ),
    runAction: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      runActionCalls.push({ ref, args });
      // Mirror the executeIntegration return shape: { result: <connectorReturn> }.
      if (args.operation === 'list_pull_requests') {
        return { result: { data: opts.pulls ?? [] } };
      }
      return { result: { data: { merged: true } } };
    }),
    runMutation: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      runMutationCalls.push({ ref, args });
      return null;
    }),
  };
  return { ctx, runActionCalls, runMutationCalls };
}

const MERGE_ARGS = { organizationId: 'org_1', taskId: 'task_1' };

describe('mergeTaskPullRequest', () => {
  const handler = (mergeTaskPullRequest as unknown as Handler).handler;

  it('squash-merges the open PR for the head branch and closes the task', async () => {
    const { ctx, runActionCalls, runMutationCalls } = createMergeCtx({
      task: { task: TASK },
      pulls: [{ number: 1913, state: 'open', merged_at: null }],
    });
    const result = await handler(ctx, MERGE_ARGS);
    expect(result).toEqual({
      merged: true,
      pullNumber: 1913,
      alreadyMerged: false,
    });

    const list = runActionCalls.find(
      (c) => c.args.operation === 'list_pull_requests',
    );
    expect(list?.args.skipApprovalCheck).toBe(true);
    expect(list?.args.params).toMatchObject({
      owner: 'tale-project',
      repo: 'tale',
      head: 'tale-project:tale/task_1',
      state: 'all',
    });

    const merge = runActionCalls.find(
      (c) => c.args.operation === 'merge_pull_request',
    );
    expect(merge?.args.skipApprovalCheck).toBe(true);
    expect(merge?.args.params).toMatchObject({
      owner: 'tale-project',
      repo: 'tale',
      pull_number: 1913,
      merge_method: 'squash',
    });

    expect(runMutationCalls).toHaveLength(1);
    expect(runMutationCalls[0].ref).toBe('updateTaskStatus');
    expect(runMutationCalls[0].args).toEqual({
      taskId: 'task_1',
      status: 'done',
    });
  });

  it('honors an explicit mergeMethod', async () => {
    const { ctx, runActionCalls } = createMergeCtx({
      task: { task: TASK },
      pulls: [{ number: 1913, state: 'open', merged_at: null }],
    });
    await handler(ctx, { ...MERGE_ARGS, mergeMethod: 'merge' });
    const merge = runActionCalls.find(
      (c) => c.args.operation === 'merge_pull_request',
    );
    expect(merge?.args.params).toMatchObject({ merge_method: 'merge' });
  });

  it('treats an already-merged PR as success and closes the task without re-merging', async () => {
    const { ctx, runActionCalls, runMutationCalls } = createMergeCtx({
      task: { task: TASK },
      pulls: [
        { number: 1913, state: 'closed', merged_at: '2026-06-21T00:00:00Z' },
      ],
    });
    const result = await handler(ctx, MERGE_ARGS);
    expect(result).toEqual({
      merged: true,
      pullNumber: 1913,
      alreadyMerged: true,
    });
    // No merge call — the PR is already merged.
    expect(
      runActionCalls.find((c) => c.args.operation === 'merge_pull_request'),
    ).toBeUndefined();
    // Still closes the task.
    expect(runMutationCalls).toHaveLength(1);
    expect(runMutationCalls[0].args).toEqual({
      taskId: 'task_1',
      status: 'done',
    });
  });

  it('throws when the task does not exist', async () => {
    const { ctx } = createMergeCtx({ task: null });
    await expect(handler(ctx, MERGE_ARGS)).rejects.toThrow('Task not found');
  });

  it('throws when the task is not linked to a GitHub repository', async () => {
    const { ctx } = createMergeCtx({
      task: { task: { ...TASK, externalId: 'not-a-ref' } },
    });
    await expect(handler(ctx, MERGE_ARGS)).rejects.toThrow(
      /not linked to a GitHub repository/,
    );
  });

  it('throws when no open or merged PR exists for the branch', async () => {
    const { ctx, runMutationCalls } = createMergeCtx({
      task: { task: TASK },
      pulls: [],
    });
    await expect(handler(ctx, MERGE_ARGS)).rejects.toThrow(
      /No open or merged pull request/,
    );
    // Never closes the task when there's nothing merged.
    expect(runMutationCalls).toHaveLength(0);
  });

  it('refuses to merge when multiple open PRs match the branch', async () => {
    const { ctx } = createMergeCtx({
      task: { task: TASK },
      pulls: [
        { number: 1, state: 'open', merged_at: null },
        { number: 2, state: 'open', merged_at: null },
      ],
    });
    await expect(handler(ctx, MERGE_ARGS)).rejects.toThrow(
      /refusing to merge ambiguously/,
    );
  });
});
