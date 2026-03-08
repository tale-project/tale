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
  const schedulerRunAfterArgs: Array<[number, unknown, unknown]> = [];
  const schedulerRunAfter = vi.fn().mockImplementation((delay, ref, args) => {
    schedulerRunAfterArgs.push([delay, ref, args]);
    return Promise.resolve(undefined);
  });
  const dbGetCalls: string[] = [];
  const dbGet = vi.fn().mockImplementation((id: string) => {
    dbGetCalls.push(id);
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
      runAfter: schedulerRunAfter,
    },
  };

  return {
    ctx: ctx as unknown as MutationCtx,
    runMutation,
    runMutationArgs,
    schedulerRunAfter,
    schedulerRunAfterArgs,
    dbGet,
    dbGetCalls,
  };
}

describe('handleWorkflowComplete', () => {
  it('schedules completion response when execution has approvalId in triggerData', async () => {
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
    const { ctx, schedulerRunAfterArgs, dbGet } = createMockCtx({
      exec,
      approval,
    });

    let execGetCount = 0;
    dbGet.mockImplementation((id: string) => {
      if (id === 'exec_1') {
        execGetCount++;
        // First fetch: initial exec (status: running)
        // Second fetch: after completeExecution for emitEvent (status: completed)
        return Promise.resolve(
          execGetCount === 1 ? exec : { ...exec, status: 'completed' },
        );
      }
      if (id === 'approval_1') return Promise.resolve(approval);
      return Promise.resolve(null);
    });

    await handleWorkflowComplete(ctx, {
      workflowId: 'component_wf_1',
      context: { executionId: 'exec_1' },
      result: { kind: 'success', returnValue: { data: 'ok' } },
    });

    const triggerCalls = schedulerRunAfterArgs.filter(
      ([, , callArgs]) =>
        callArgs &&
        typeof callArgs === 'object' &&
        'threadId' in callArgs &&
        'messageContent' in callArgs,
    );
    expect(triggerCalls.length).toBe(1);
    const [delay, , args] = triggerCalls[0];
    expect(delay).toBe(0);
    const typedArgs = args as {
      threadId: string;
      organizationId: string;
      messageContent: string;
    };
    expect(typedArgs.threadId).toBe('thread_1');
    expect(typedArgs.organizationId).toBe('org_1');
    expect(typedArgs.messageContent).toContain('[WORKFLOW_COMPLETED]');
    expect(typedArgs.messageContent).toContain('my-workflow');
  });

  it('includes output data in completion message when available', async () => {
    const exec = {
      _id: 'exec_1',
      organizationId: 'org_1',
      workflowSlug: 'report-workflow',
      triggerData: { approvalId: 'approval_1', approvedBy: 'user_1' },
      status: 'running',
    };
    const approval = {
      _id: 'approval_1',
      threadId: 'thread_1',
    };
    const { ctx, schedulerRunAfterArgs, dbGet } = createMockCtx({
      exec,
      approval,
    });

    let execGetCount = 0;
    dbGet.mockImplementation((id: string) => {
      if (id === 'exec_1') {
        execGetCount++;
        return Promise.resolve(
          execGetCount === 1 ? exec : { ...exec, status: 'completed' },
        );
      }
      if (id === 'approval_1') return Promise.resolve(approval);
      return Promise.resolve(null);
    });

    await handleWorkflowComplete(ctx, {
      workflowId: 'component_wf_1',
      context: { executionId: 'exec_1' },
      result: {
        kind: 'success',
        returnValue: {
          downloadUrl: 'https://example.com/report.docx',
          fileName: 'report.docx',
        },
      },
    });

    const triggerCalls = schedulerRunAfterArgs.filter(
      ([, , callArgs]) =>
        callArgs &&
        typeof callArgs === 'object' &&
        'messageContent' in callArgs,
    );
    expect(triggerCalls.length).toBe(1);
    const [, , args] = triggerCalls[0];
    const typedArgs = args as { messageContent: string };
    expect(typedArgs.messageContent).toContain('Workflow Output:');
    expect(typedArgs.messageContent).toContain('report.docx');
    expect(typedArgs.messageContent).toContain(
      'https://example.com/report.docx',
    );
  });

  it('excludes output containing _storageRef from message', async () => {
    const exec = {
      _id: 'exec_1',
      organizationId: 'org_1',
      workflowSlug: 'blob-workflow',
      triggerData: { approvalId: 'approval_1', approvedBy: 'user_1' },
      status: 'running',
    };
    const approval = {
      _id: 'approval_1',
      threadId: 'thread_1',
    };
    const { ctx, schedulerRunAfterArgs, dbGet } = createMockCtx({
      exec,
      approval,
    });

    let execGetCount = 0;
    dbGet.mockImplementation((id: string) => {
      if (id === 'exec_1') {
        execGetCount++;
        return Promise.resolve(
          execGetCount === 1 ? exec : { ...exec, status: 'completed' },
        );
      }
      if (id === 'approval_1') return Promise.resolve(approval);
      return Promise.resolve(null);
    });

    await handleWorkflowComplete(ctx, {
      workflowId: 'component_wf_1',
      context: { executionId: 'exec_1' },
      result: {
        kind: 'success',
        returnValue: { _storageRef: 'kg278fznabcg53cpt8jjqzm3n982gq94' },
      },
    });

    const triggerCalls = schedulerRunAfterArgs.filter(
      ([, , callArgs]) =>
        callArgs &&
        typeof callArgs === 'object' &&
        'messageContent' in callArgs,
    );
    expect(triggerCalls.length).toBe(1);
    const [, , args] = triggerCalls[0];
    const typedArgs = args as { messageContent: string };
    expect(typedArgs.messageContent).not.toContain('Workflow Output:');
    expect(typedArgs.messageContent).not.toContain('_storageRef');
  });

  it('schedules failure response when execution fails', async () => {
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
    const { ctx, schedulerRunAfterArgs, dbGet } = createMockCtx({
      exec,
      approval,
    });

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

    const triggerCalls = schedulerRunAfterArgs.filter(
      ([, , callArgs]) =>
        callArgs &&
        typeof callArgs === 'object' &&
        'messageContent' in callArgs,
    );
    expect(triggerCalls.length).toBe(1);
    const [, , args] = triggerCalls[0];
    const typedArgs = args as { messageContent: string };
    expect(typedArgs.messageContent).toContain('[WORKFLOW_FAILED]');
    expect(typedArgs.messageContent).toContain('step timed out');
  });

  it('does not schedule response when no approvalId in triggerData', async () => {
    const exec = {
      _id: 'exec_1',
      organizationId: 'org_1',
      workflowSlug: 'scheduled-workflow',
      triggerData: { source: 'schedule' },
      status: 'running',
    };
    const { ctx, schedulerRunAfterArgs, dbGet } = createMockCtx({ exec });

    let execGetCount = 0;
    dbGet.mockImplementation((id: string) => {
      if (id === 'exec_1') {
        execGetCount++;
        return Promise.resolve(
          execGetCount === 1 ? exec : { ...exec, status: 'completed' },
        );
      }
      return Promise.resolve(null);
    });

    await handleWorkflowComplete(ctx, {
      workflowId: 'component_wf_1',
      context: { executionId: 'exec_1' },
      result: { kind: 'success', returnValue: {} },
    });

    const triggerCalls = schedulerRunAfterArgs.filter(
      ([, , callArgs]) =>
        callArgs &&
        typeof callArgs === 'object' &&
        'messageContent' in callArgs,
    );
    expect(triggerCalls.length).toBe(0);
  });

  it('skips posting when execution is already in terminal state (idempotency)', async () => {
    const exec = {
      _id: 'exec_1',
      organizationId: 'org_1',
      workflowSlug: 'already-done',
      triggerData: { approvalId: 'approval_1', approvedBy: 'user_1' },
      status: 'completed',
    };
    const approval = {
      _id: 'approval_1',
      threadId: 'thread_1',
    };
    const { ctx, schedulerRunAfterArgs, dbGet } = createMockCtx({
      exec,
      approval,
    });

    dbGet.mockImplementation((id: string) => {
      if (id === 'exec_1') return Promise.resolve(exec);
      if (id === 'approval_1') return Promise.resolve(approval);
      return Promise.resolve(null);
    });

    await handleWorkflowComplete(ctx, {
      workflowId: 'component_wf_1',
      context: { executionId: 'exec_1' },
      result: { kind: 'success', returnValue: { data: 'ok' } },
    });

    const triggerCalls = schedulerRunAfterArgs.filter(
      ([, , callArgs]) =>
        callArgs &&
        typeof callArgs === 'object' &&
        'messageContent' in callArgs,
    );
    expect(triggerCalls.length).toBe(0);
  });
});
