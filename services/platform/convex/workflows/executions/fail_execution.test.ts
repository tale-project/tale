import { describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { failExecution, notifyWorkflowFailedOnce } from './fail_execution';

function execution(
  overrides: Partial<Doc<'wfExecutions'>> = {},
): Doc<'wfExecutions'> {
  return {
    _id: 'exec_1' as Id<'wfExecutions'>,
    _creationTime: 0,
    organizationId: 'org_1',
    wfDefinitionId: null,
    status: 'failed',
    currentStepSlug: 'step',
    startedAt: 0,
    updatedAt: 0,
    workflowSlug: 'nightly-sync',
    ...overrides,
  } as Doc<'wfExecutions'>;
}

function mockCtx(executionDoc: Doc<'wfExecutions'> | null = null) {
  return {
    db: {
      get: vi.fn(async (_id: string) => executionDoc),
      patch: vi.fn(async (_id: string, _data: unknown) => undefined),
    },
    scheduler: {
      runAfter: vi.fn(
        async (_delay: number, _fn: unknown, _args: unknown) => undefined,
      ),
    },
  };
}

describe('notifyWorkflowFailedOnce', () => {
  it('notifies + marks the execution on first failure', async () => {
    const ctx = mockCtx();
    await notifyWorkflowFailedOnce(
      ctx as unknown as MutationCtx,
      execution(),
      'boom',
    );

    expect(ctx.db.patch).toHaveBeenCalledWith(
      'exec_1',
      expect.objectContaining({ failureNotifiedAt: expect.any(Number) }),
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalledTimes(1);
    const [, , args] = ctx.scheduler.runAfter.mock.calls[0];
    expect(args).toMatchObject({
      organizationId: 'org_1',
      eventType: 'workflow.failed',
      params: { workflowSlug: 'nightly-sync', error: 'boom' },
    });
  });

  it('does not notify again once the marker is set (idempotent)', async () => {
    const ctx = mockCtx();
    await notifyWorkflowFailedOnce(
      ctx as unknown as MutationCtx,
      execution({ failureNotifiedAt: 123 }),
      'boom',
    );
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('does nothing for a missing execution', async () => {
    const ctx = mockCtx();
    await notifyWorkflowFailedOnce(ctx as unknown as MutationCtx, null, 'boom');
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });
});

describe('failExecution', () => {
  const executionId = 'exec_1' as Id<'wfExecutions'>;

  it('persists the error at the top level with errorCode and completedAt', async () => {
    const ctx = mockCtx(execution({ status: 'running' }));

    await failExecution(ctx as unknown as MutationCtx, {
      executionId,
      error: 'step exploded',
      errorCode: 'step_failure',
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      'exec_1',
      expect.objectContaining({
        status: 'failed',
        error: 'step exploded',
        errorCode: 'step_failure',
        completedAt: expect.any(Number),
      }),
    );
  });

  it('merges the error into existing metadata instead of clobbering it', async () => {
    const ctx = mockCtx(
      execution({
        status: 'running',
        metadata: JSON.stringify({
          componentWorkflowIds: ['wf_component_1'],
          custom: 'kept',
        }),
      }),
    );

    await failExecution(ctx as unknown as MutationCtx, {
      executionId,
      error: 'boom',
    });

    const patchCall = ctx.db.patch.mock.calls.find(
      ([, data]) =>
        typeof data === 'object' && data !== null && 'metadata' in data,
    );
    expect(patchCall).toBeDefined();
    const data = patchCall?.[1] as { metadata: string };
    expect(JSON.parse(data.metadata)).toEqual({
      componentWorkflowIds: ['wf_component_1'],
      custom: 'kept',
      error: 'boom',
    });
  });

  it('keeps an existing completedAt (first terminal transition wins)', async () => {
    const ctx = mockCtx(execution({ completedAt: 42 }));

    await failExecution(ctx as unknown as MutationCtx, {
      executionId,
      error: 'boom',
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      'exec_1',
      expect.objectContaining({ completedAt: 42 }),
    );
  });

  it('replaces unparseable metadata rather than throwing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = mockCtx(execution({ metadata: 'not json{' }));

    await failExecution(ctx as unknown as MutationCtx, {
      executionId,
      error: 'boom',
    });

    const data = ctx.db.patch.mock.calls[0][1] as { metadata: string };
    expect(JSON.parse(data.metadata)).toEqual({ error: 'boom' });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
