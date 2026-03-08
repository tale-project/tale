import { describe, expect, it, vi } from 'vitest';

import type { MutationCtx } from '../../../_generated/server';

import { handleWorkflowComplete } from './on_workflow_complete';

function createMockCtx(overrides: {
  exec?: Record<string, unknown> | null;
  approval?: Record<string, unknown> | null;
}) {
  const runMutationArgs: Array<[unknown, unknown]> = [];
  const runMutation = vi.fn().mockImplementation((ref, args) => {
    runMutationArgs.push([ref, args]);
    return Promise.resolve(undefined);
  });
  const dbGet = vi.fn().mockImplementation((id: string) => {
    if (id === 'exec_1' || id === overrides.exec?._id) {
      return Promise.resolve(overrides.exec ?? null);
    }
    if (id === 'approval_1') {
      return Promise.resolve(overrides.approval ?? null);
    }
    return Promise.resolve(null);
  });

  const ctx = {
    db: {
      get: dbGet,
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
        }),
      }),
    },
    runMutation,
    scheduler: {
      runAfter: vi.fn().mockResolvedValue(undefined),
    },
  };

  return {
    ctx: ctx as unknown as MutationCtx,
    runMutation,
    runMutationArgs,
    dbGet,
  };
}

describe('handleWorkflowComplete', () => {
  it('posts completion system message when execution has approvalId in triggerData', async () => {
    const exec = {
      _id: 'exec_1',
      organizationId: 'org_1',
      workflowSlug: 'my-workflow',
      triggerData: { approvalId: 'approval_1', approvedBy: 'user_1' },
      status: 'running',
    };
    const approval = {
      _id: 'approval_1',
      threadId: 'thread_1',
    };
    const { ctx, runMutationArgs, dbGet } = createMockCtx({ exec, approval });

    dbGet.mockImplementation((id: string) => {
      if (id === 'exec_1')
        return Promise.resolve({ ...exec, status: 'completed' });
      if (id === 'approval_1') return Promise.resolve(approval);
      return Promise.resolve(null);
    });

    await handleWorkflowComplete(ctx, {
      workflowId: 'component_wf_1',
      context: { executionId: 'exec_1' },
      result: { kind: 'success', returnValue: { data: 'ok' } },
    });

    // Find the saveSystemMessage call by checking the args (threadId + content)
    const systemMessageCalls = runMutationArgs.filter(
      ([, callArgs]) =>
        callArgs &&
        typeof callArgs === 'object' &&
        'threadId' in callArgs &&
        'content' in callArgs,
    );
    expect(systemMessageCalls.length).toBe(1);
    const [, args] = systemMessageCalls[0];
    const typedArgs = args as { threadId: string; content: string };
    expect(typedArgs.threadId).toBe('thread_1');
    expect(typedArgs.content).toContain('[WORKFLOW_COMPLETED]');
    expect(typedArgs.content).toContain('my-workflow');
  });

  it('posts failure system message when execution fails', async () => {
    const exec = {
      _id: 'exec_1',
      organizationId: 'org_1',
      workflowSlug: 'failing-workflow',
      triggerData: { approvalId: 'approval_1', approvedBy: 'user_1' },
      status: 'running',
    };
    const approval = {
      _id: 'approval_1',
      threadId: 'thread_1',
    };
    const { ctx, runMutationArgs, dbGet } = createMockCtx({ exec, approval });

    dbGet.mockImplementation((id: string) => {
      if (id === 'exec_1') return Promise.resolve(exec);
      if (id === 'approval_1') return Promise.resolve(approval);
      return Promise.resolve(null);
    });

    await handleWorkflowComplete(ctx, {
      workflowId: 'component_wf_1',
      context: { executionId: 'exec_1' },
      result: { kind: 'failed', error: 'step timed out' },
    });

    const systemMessageCalls = runMutationArgs.filter(
      ([, callArgs]) =>
        callArgs &&
        typeof callArgs === 'object' &&
        'threadId' in callArgs &&
        'content' in callArgs,
    );
    expect(systemMessageCalls.length).toBe(1);
    const [, args] = systemMessageCalls[0];
    const typedArgs = args as { threadId: string; content: string };
    expect(typedArgs.content).toContain('[WORKFLOW_FAILED]');
    expect(typedArgs.content).toContain('step timed out');
  });

  it('does not post system message when no approvalId in triggerData', async () => {
    const exec = {
      _id: 'exec_1',
      organizationId: 'org_1',
      workflowSlug: 'scheduled-workflow',
      triggerData: { source: 'schedule' },
      status: 'running',
    };
    const { ctx, runMutationArgs, dbGet } = createMockCtx({ exec });

    dbGet.mockImplementation((id: string) => {
      if (id === 'exec_1')
        return Promise.resolve({ ...exec, status: 'completed' });
      return Promise.resolve(null);
    });

    await handleWorkflowComplete(ctx, {
      workflowId: 'component_wf_1',
      context: { executionId: 'exec_1' },
      result: { kind: 'success', returnValue: {} },
    });

    const systemMessageCalls = runMutationArgs.filter(
      ([, callArgs]) =>
        callArgs &&
        typeof callArgs === 'object' &&
        'threadId' in callArgs &&
        'content' in callArgs,
    );
    expect(systemMessageCalls.length).toBe(0);
  });
});
