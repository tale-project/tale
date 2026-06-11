import { describe, expect, it, vi, beforeEach } from 'vitest';

import { toId } from '../../lib/type_cast_helpers';

const h = vi.hoisted(() => ({
  managers: Array.from({ length: 4 }, () => ({ sendEvent: vi.fn() })),
}));

vi.mock('../../workflow_engine/engine', () => ({
  workflowManagers: h.managers,
}));

import type { MutationCtx } from '../../_generated/server';
import { resumeDebugStep } from './resume_debug_step';

function createMockCtx(execution: Record<string, unknown> | null) {
  const ctx = { db: { get: vi.fn().mockResolvedValue(execution) } };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only: minimal MutationCtx surface
  return ctx as unknown as MutationCtx;
}

const executionId = toId<'wfExecutions'>('exec-1');

function pausedExecution(overrides?: Record<string, unknown>) {
  return {
    _id: executionId,
    status: 'running',
    waitingFor: 'debug:3:send-email',
    componentWorkflowId: 'component-wf-1',
    shardIndex: 2,
    ...overrides,
  };
}

beforeEach(() => {
  for (const manager of h.managers) manager.sendEvent.mockClear();
});

describe('resumeDebugStep', () => {
  it('throws when the execution does not exist', async () => {
    await expect(
      resumeDebugStep(createMockCtx(null), { executionId, action: 'step' }),
    ).rejects.toThrow('Execution not found');
  });

  it('throws when the execution is not running', async () => {
    await expect(
      resumeDebugStep(createMockCtx(pausedExecution({ status: 'completed' })), {
        executionId,
        action: 'step',
      }),
    ).rejects.toThrow('Cannot resume a debug step');
  });

  it('throws when the execution is not paused in debug mode', async () => {
    await expect(
      resumeDebugStep(
        createMockCtx(pausedExecution({ waitingFor: 'approval-id-123' })),
        { executionId, action: 'continue' },
      ),
    ).rejects.toThrow('not paused in debug mode');

    await expect(
      resumeDebugStep(
        createMockCtx(pausedExecution({ waitingFor: undefined })),
        { executionId, action: 'step' },
      ),
    ).rejects.toThrow('not paused in debug mode');
  });

  it('throws when the component workflow id is missing', async () => {
    await expect(
      resumeDebugStep(
        createMockCtx(pausedExecution({ componentWorkflowId: undefined })),
        { executionId, action: 'step' },
      ),
    ).rejects.toThrow('component workflow ID');
  });

  it('sends the per-pause debug event on the execution shard manager', async () => {
    const ctx = createMockCtx(pausedExecution());

    await expect(
      resumeDebugStep(ctx, { executionId, action: 'step' }),
    ).resolves.toBeNull();

    expect(h.managers[2].sendEvent).toHaveBeenCalledTimes(1);
    expect(h.managers[2].sendEvent).toHaveBeenCalledWith(ctx, {
      workflowId: 'component-wf-1',
      name: 'debug:3',
      value: { action: 'step' },
    });
    expect(h.managers[0].sendEvent).not.toHaveBeenCalled();
  });

  it('falls back to shard 0 for invalid shard indices', async () => {
    const ctx = createMockCtx(pausedExecution({ shardIndex: undefined }));

    await resumeDebugStep(ctx, { executionId, action: 'continue' });

    expect(h.managers[0].sendEvent).toHaveBeenCalledWith(ctx, {
      workflowId: 'component-wf-1',
      name: 'debug:3',
      value: { action: 'continue' },
    });
  });
});
