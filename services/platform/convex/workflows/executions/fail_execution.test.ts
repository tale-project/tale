import { describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { notifyWorkflowFailedOnce } from './fail_execution';

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

function mockCtx() {
  return {
    db: { patch: vi.fn(async (_id: string, _data: unknown) => undefined) },
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
