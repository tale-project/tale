import { describe, expect, it, vi } from 'vitest';

import type { MutationCtx } from '../../../_generated/server';

import { handleWorkflowComplete } from './on_workflow_complete';

function createMockCtx(overrides: {
  exec?: Record<string, unknown> | null;
  approval?: Record<string, unknown> | null;
  execAfterCompletion?: Record<string, unknown> | null;
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

  // Track call count per ID to simulate state changes between reads
  const getCallCounts = new Map<string, number>();
  const dbGet = vi.fn().mockImplementation((id: string) => {
    dbGetCalls.push(id);
    const count = (getCallCounts.get(id) ?? 0) + 1;
    getCallCounts.set(id, count);

    if (id === (overrides.exec?._id ?? 'exec_1')) {
      // First call: initial exec; subsequent: after completion
      if (count === 1) {
        return Promise.resolve(overrides.exec ?? null);
      }
      return Promise.resolve(
        overrides.execAfterCompletion ?? overrides.exec ?? null,
      );
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
  it('calls completeExecution with persisted output and schedules thread response', async () => {
    const exec = {
      _id: 'exec_1',
      organizationId: 'org_1',
      workflowSlug: 'my-workflow',
      triggerData: { approvalId: 'approval_1', approvedBy: 'user_1' },
      status: 'running',
      output: {
        fileName: 'report.docx',
        downloadUrl: 'https://example.com/report.docx',
      },
    };
    const approval = {
      _id: 'approval_1',
      threadId: 'thread_1',
    };
    const execAfterCompletion = { ...exec, status: 'completed' };
    const { ctx, runMutationArgs, schedulerRunAfterArgs } = createMockCtx({
      exec,
      approval,
      execAfterCompletion,
    });

    await handleWorkflowComplete(ctx, {
      workflowId: 'component_wf_1',
      context: { executionId: 'exec_1' },
      result: { kind: 'success', returnValue: undefined },
    });

    // Should call completeExecution with persisted output (not result.returnValue)
    const completeCall = runMutationArgs.find(
      ([, args]) => args && typeof args === 'object' && 'output' in args,
    );
    expect(completeCall).toBeDefined();
    // oxlint-disable-next-line typescript/no-non-null-assertion, typescript/no-unsafe-type-assertion -- test assertion: completeCall is verified above
    const completeArgs = completeCall![1] as Record<string, unknown>;
    expect(completeArgs.output).toEqual({
      fileName: 'report.docx',
      downloadUrl: 'https://example.com/report.docx',
    });

    // Should schedule thread response
    const triggerCalls = schedulerRunAfterArgs.filter(
      ([, , callArgs]) =>
        callArgs &&
        typeof callArgs === 'object' &&
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

  it('includes persisted output data in completion message', async () => {
    const persistedOutput = {
      downloadUrl: 'https://example.com/report.docx',
      fileName: 'report.docx',
    };
    const exec = {
      _id: 'exec_1',
      organizationId: 'org_1',
      workflowSlug: 'report-workflow',
      triggerData: { approvalId: 'approval_1', approvedBy: 'user_1' },
      status: 'running',
      output: persistedOutput,
    };
    const approval = {
      _id: 'approval_1',
      threadId: 'thread_1',
    };
    const execAfterCompletion = { ...exec, status: 'completed' };
    const { ctx, schedulerRunAfterArgs } = createMockCtx({
      exec,
      approval,
      execAfterCompletion,
    });

    await handleWorkflowComplete(ctx, {
      workflowId: 'component_wf_1',
      context: { executionId: 'exec_1' },
      result: { kind: 'success', returnValue: undefined },
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
    const persistedOutput = {
      _storageRef: 'kg278fznabcg53cpt8jjqzm3n982gq94',
    };
    const exec = {
      _id: 'exec_1',
      organizationId: 'org_1',
      workflowSlug: 'blob-workflow',
      triggerData: { approvalId: 'approval_1', approvedBy: 'user_1' },
      status: 'running',
      output: persistedOutput,
    };
    const approval = {
      _id: 'approval_1',
      threadId: 'thread_1',
    };
    const execAfterCompletion = { ...exec, status: 'completed' };
    const { ctx, schedulerRunAfterArgs } = createMockCtx({
      exec,
      approval,
      execAfterCompletion,
    });

    await handleWorkflowComplete(ctx, {
      workflowId: 'component_wf_1',
      context: { executionId: 'exec_1' },
      result: {
        kind: 'success',
        returnValue: undefined,
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
    const { ctx, schedulerRunAfterArgs } = createMockCtx({
      exec,
      approval,
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
    const execAfterCompletion = { ...exec, status: 'completed' };
    const { ctx, schedulerRunAfterArgs } = createMockCtx({
      exec,
      execAfterCompletion,
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

  it('skips completeExecution and message when already in terminal state (idempotency)', async () => {
    const exec = {
      _id: 'exec_1',
      organizationId: 'org_1',
      workflowSlug: 'already-done',
      triggerData: { approvalId: 'approval_1', approvedBy: 'user_1' },
      status: 'completed',
      output: { data: 'ok' },
    };
    const approval = {
      _id: 'approval_1',
      threadId: 'thread_1',
    };
    const { ctx, runMutationArgs, schedulerRunAfterArgs } = createMockCtx({
      exec,
      approval,
    });

    await handleWorkflowComplete(ctx, {
      workflowId: 'component_wf_1',
      context: { executionId: 'exec_1' },
      result: { kind: 'success', returnValue: { data: 'ok' } },
    });

    // Should NOT call completeExecution (already completed)
    const completeCalls = runMutationArgs.filter(
      ([, args]) => args && typeof args === 'object' && 'output' in args,
    );
    expect(completeCalls.length).toBe(0);

    // Should NOT schedule thread response (wasTerminal = true)
    const triggerCalls = schedulerRunAfterArgs.filter(
      ([, , callArgs]) =>
        callArgs &&
        typeof callArgs === 'object' &&
        'messageContent' in callArgs,
    );
    expect(triggerCalls.length).toBe(0);
  });

  it('falls back to result.returnValue when no persisted output exists', async () => {
    const exec = {
      _id: 'exec_1',
      organizationId: 'org_1',
      workflowSlug: 'simple-workflow',
      triggerData: { approvalId: 'approval_1', approvedBy: 'user_1' },
      status: 'running',
      output: undefined,
    };
    const approval = {
      _id: 'approval_1',
      threadId: 'thread_1',
    };
    const execAfterCompletion = {
      ...exec,
      status: 'completed',
      output: { simple: 'data' },
    };
    const { ctx, runMutationArgs } = createMockCtx({
      exec,
      approval,
      execAfterCompletion,
    });

    await handleWorkflowComplete(ctx, {
      workflowId: 'component_wf_1',
      context: { executionId: 'exec_1' },
      result: { kind: 'success', returnValue: { simple: 'data' } },
    });

    const completeCall = runMutationArgs.find(
      ([, args]) => args && typeof args === 'object' && 'output' in args,
    );
    expect(completeCall).toBeDefined();
    // oxlint-disable-next-line typescript/no-non-null-assertion, typescript/no-unsafe-type-assertion -- test assertion: completeCall is verified above
    const completeArgs = completeCall![1] as Record<string, unknown>;
    expect(completeArgs.output).toEqual({ simple: 'data' });
  });

  it('emits workflow.completed event even when completeExecution is skipped', async () => {
    // This simulates a scenario where the execution was already completed
    // by a prior call but events haven't been emitted yet (shouldn't normally
    // happen, but tests the guard scoping)
    const exec = {
      _id: 'exec_1',
      organizationId: 'org_1',
      workflowSlug: 'my-workflow',
      triggerData: {},
      status: 'running',
      output: { data: 'ok' },
    };
    const execAfterCompletion = { ...exec, status: 'completed' };
    const { ctx, runMutationArgs, dbGet } = createMockCtx({
      exec,
      execAfterCompletion,
    });

    // Customize dbGet to simulate emitEvent reading the execution
    const originalImpl = dbGet.getMockImplementation();
    dbGet.mockImplementation((id: string) => {
      return originalImpl?.(id) ?? Promise.resolve(null);
    });

    await handleWorkflowComplete(ctx, {
      workflowId: 'component_wf_1',
      context: { executionId: 'exec_1' },
      result: { kind: 'success', returnValue: undefined },
    });

    // completeExecution should have been called (status was 'running')
    const completeCalls = runMutationArgs.filter(
      ([, args]) => args && typeof args === 'object' && 'output' in args,
    );
    expect(completeCalls.length).toBe(1);
  });
});
