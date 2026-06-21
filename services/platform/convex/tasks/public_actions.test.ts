import { describe, expect, it, vi } from 'vitest';

import { startTaskWorkflow } from './public_actions';

// Mock-ctx idiom (see external_runs/state_machine.test.ts): the generated server
// wrapper returns its config so `.handler` is callable; api/internal refs become
// string sentinels the fake ctx dispatches on; auth is a no-op.
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, action: (config: Record<string, unknown>) => config };
});

vi.mock('../_generated/api', () => ({
  api: {
    tasks: { queries: { getTask: 'getTask' } },
    workflow_executions: {
      actions: { startWorkflowFromFile: 'startWorkflowFromFile' },
    },
  },
  internal: {
    workflow_executions: {
      internal_queries: { getActiveExecutionForSubject: 'getActive' },
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
