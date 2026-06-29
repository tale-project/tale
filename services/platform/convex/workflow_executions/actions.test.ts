import { ConvexError } from 'convex/values';
import { describe, expect, it, vi } from 'vitest';

import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { rerunExecution } from './actions';

/** Pull the structured `code` off a thrown ConvexError (the issue #2013 fix:
 * execution-management rejections carry a code, not an opaque message). */
async function catchCode(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ConvexError) {
      return (err.data as { code?: unknown }).code;
    }
    throw err;
  }
  return undefined;
}

// Mock-ctx idiom (see external_runs/state_machine.test.ts).
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, action: (config: Record<string, unknown>) => config };
});

vi.mock('../_generated/api', () => ({
  api: {
    workflow_executions: {
      actions: { startWorkflowFromFile: 'startWorkflowFromFile' },
    },
  },
  internal: {
    workflow_executions: {
      internal_queries: {
        getRawExecution: 'getRawExecution',
        getActiveExecutionForSubject: 'getActive',
      },
    },
    approvals: {
      internal_queries: { verifyOrganizationMembership: 'verifyMembership' },
    },
  },
}));

vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: vi.fn(async () => ({
    userId: 'user_1',
    email: 'u@x.dev',
    name: 'U',
  })),
}));

// oxlint-disable-next-line typescript/no-explicit-any -- vi.mock narrows to { handler }
type Handler = { handler: (ctx: unknown, args: unknown) => Promise<any> };

const EXECUTION = {
  _id: 'exec_old',
  organizationId: 'org_1',
  workflowSlug: 'issue-desk/desk-process',
  input: { task: { _id: 'task_1' }, issueNumber: 1851 },
  triggerData: { foo: 'bar' },
  subjectType: 'task',
  subjectId: 'task_1',
};

function createCtx(opts: {
  execution?: unknown;
  active?: unknown;
  startResult?: string | null;
}) {
  const runActionCalls: Array<{ ref: unknown; args: Record<string, unknown> }> =
    [];
  const ctx = {
    runQuery: vi.fn(async (ref: unknown) => {
      if (ref === 'getRawExecution') return opts.execution ?? null;
      if (ref === 'getActive') return opts.active ?? null;
      if (ref === 'verifyMembership') return undefined;
      return null;
    }),
    runAction: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      runActionCalls.push({ ref, args });
      return opts.startResult ?? null;
    }),
  };
  return { ctx, runActionCalls };
}

describe('rerunExecution', () => {
  const handler = (rerunExecution as unknown as Handler).handler;

  it('copies input/triggerData/subject into a fresh subject-linked run', async () => {
    const { ctx, runActionCalls } = createCtx({
      execution: EXECUTION,
      active: null,
      startResult: 'exec_new',
    });
    const result = await handler(ctx, { executionId: 'exec_old' });
    expect(result).toEqual({ started: true, executionId: 'exec_new' });
    expect(runActionCalls).toHaveLength(1);
    expect(runActionCalls[0].args).toMatchObject({
      organizationId: 'org_1',
      workflowSlug: 'issue-desk/desk-process',
      triggeredBy: 'user',
      input: EXECUTION.input,
      triggerData: EXECUTION.triggerData,
      subject: { type: 'task', id: 'task_1' },
    });
  });

  it('throws UNAUTHENTICATED when the caller is not signed in', async () => {
    // Force the auth gate (actions.ts:100) to fail; the code must surface as a
    // structured ConvexError, not an opaque "Server Error".
    vi.mocked(getAuthUserIdentity).mockResolvedValueOnce(null);
    const { ctx } = createCtx({ execution: EXECUTION });
    await expect(
      catchCode(() => handler(ctx, { executionId: 'exec_old' })),
    ).resolves.toBe('UNAUTHENTICATED');
  });

  it('throws EXECUTION_NOT_FOUND when the execution is missing', async () => {
    const { ctx } = createCtx({ execution: null });
    await expect(
      catchCode(() => handler(ctx, { executionId: 'exec_x' })),
    ).resolves.toBe('EXECUTION_NOT_FOUND');
  });

  it('throws EXECUTION_MISSING_SLUG when the execution has no workflow slug to start from', async () => {
    const { ctx } = createCtx({
      execution: { ...EXECUTION, workflowSlug: undefined },
    });
    await expect(
      catchCode(() => handler(ctx, { executionId: 'exec_old' })),
    ).resolves.toBe('EXECUTION_MISSING_SLUG');
  });

  it('refuses (already_running) when a run for the subject is in flight', async () => {
    const { ctx, runActionCalls } = createCtx({
      execution: EXECUTION,
      active: { executionId: 'exec_live', status: 'running' },
    });
    const result = await handler(ctx, { executionId: 'exec_old' });
    expect(result).toEqual({
      started: false,
      reason: 'already_running',
      executionId: 'exec_live',
    });
    expect(runActionCalls).toHaveLength(0);
  });

  it('re-runs a subject-less execution without consulting the subject guard', async () => {
    const { ctx, runActionCalls } = createCtx({
      execution: {
        ...EXECUTION,
        subjectType: undefined,
        subjectId: undefined,
      },
      startResult: 'exec_new',
    });
    const result = await handler(ctx, { executionId: 'exec_old' });
    expect(result).toEqual({ started: true, executionId: 'exec_new' });
    expect(runActionCalls[0].args.subject).toBeUndefined();
  });
});
