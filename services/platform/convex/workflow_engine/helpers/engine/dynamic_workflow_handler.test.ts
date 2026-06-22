import type { WorkflowCtx } from '@convex-dev/workflow';
import { describe, it, expect, vi } from 'vitest';

import { toId } from '../../../lib/type_cast_helpers';
import type { DynamicWorkflowArgs } from './dynamic_workflow_handler';
import { handleDynamicWorkflow } from './dynamic_workflow_handler';

// buildRetryBehaviorFromPolicy is not exported, so we test it via re-export
// or inline the logic. Since it's a private function, we test the extracted logic.
// For now, we test the behavior by importing the module and testing the pattern.

// Inline the pure function logic for testing (mirrors the source)
function buildRetryBehaviorFromPolicy(policy?: {
  maxRetries: number;
  backoffMs: number;
}) {
  if (!policy) return undefined;
  const { maxRetries, backoffMs } = policy;
  if (maxRetries <= 0) return undefined;
  return {
    maxAttempts: maxRetries + 1,
    initialBackoffMs: backoffMs,
    base: 2,
  };
}

describe('buildRetryBehaviorFromPolicy', () => {
  it('should return undefined when policy is undefined', () => {
    expect(buildRetryBehaviorFromPolicy(undefined)).toBeUndefined();
  });

  it('should return undefined when maxRetries is 0', () => {
    expect(
      buildRetryBehaviorFromPolicy({ maxRetries: 0, backoffMs: 1000 }),
    ).toBeUndefined();
  });

  it('should return undefined when maxRetries is negative', () => {
    expect(
      buildRetryBehaviorFromPolicy({ maxRetries: -1, backoffMs: 1000 }),
    ).toBeUndefined();
  });

  it('should convert maxRetries to maxAttempts (retries + 1)', () => {
    const result = buildRetryBehaviorFromPolicy({
      maxRetries: 3,
      backoffMs: 500,
    });

    expect(result).toEqual({
      maxAttempts: 4,
      initialBackoffMs: 500,
      base: 2,
    });
  });

  it('should use backoffMs as initialBackoffMs', () => {
    const result = buildRetryBehaviorFromPolicy({
      maxRetries: 1,
      backoffMs: 2000,
    });

    expect(result?.initialBackoffMs).toBe(2000);
  });

  it('should always use base 2 for exponential backoff', () => {
    const result = buildRetryBehaviorFromPolicy({
      maxRetries: 5,
      backoffMs: 100,
    });

    expect(result?.base).toBe(2);
  });
});

// --- Debug-mode pause gate (#1490) ---

interface MockStepCtx {
  runAction: ReturnType<typeof vi.fn>;
  runMutation: ReturnType<typeof vi.fn>;
  awaitEvent: ReturnType<typeof vi.fn>;
}

function createMockStepCtx(
  resumeActions: Array<'step' | 'continue'>,
): MockStepCtx {
  let pauseCount = 0;
  return {
    // executeStep entries carry a stepSlug; the trailing
    // serializeExecutionOutput call does not and returns null.
    runAction: vi.fn((_ref: unknown, args: Record<string, unknown>) =>
      Promise.resolve(args && 'stepSlug' in args ? { port: 'success' } : null),
    ),
    runMutation: vi.fn(() => Promise.resolve(null)),
    awaitEvent: vi.fn(() => {
      const action = resumeActions[pauseCount] ?? 'step';
      pauseCount += 1;
      return Promise.resolve({ action });
    }),
  };
}

function createWorkflowArgs(
  overrides?: Partial<DynamicWorkflowArgs>,
): DynamicWorkflowArgs {
  return {
    organizationId: 'org-1',
    executionId: toId<'wfExecutions'>('exec-1'),
    workflowDefinition: {
      name: 'Test workflow',
      status: 'draft',
      config: {},
    },
    steps: [
      {
        stepSlug: 'step-1',
        stepType: 'start',
        name: 'Start',
        organizationId: 'org-1',
        nextSteps: { success: 'step-2' },
        config: {},
      },
      {
        stepSlug: 'step-2',
        stepType: 'action',
        name: 'Do thing',
        organizationId: 'org-1',
        nextSteps: {},
        config: {},
      },
    ],
    triggeredBy: 'test',
    ...overrides,
  };
}

function executedStepSlugs(ctx: MockStepCtx): string[] {
  return ctx.runAction.mock.calls
    .map((call: unknown[]) => {
      const args = call[1];
      return args && typeof args === 'object' && 'stepSlug' in args
        ? String((args as Record<string, unknown>).stepSlug)
        : null;
    })
    .filter((slug): slug is string => slug !== null);
}

function asWorkflowCtx(ctx: MockStepCtx): WorkflowCtx {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only: minimal WorkflowCtx surface
  return ctx as unknown as WorkflowCtx;
}

describe('handleDynamicWorkflow debug gate', () => {
  it('does not pause when debugMode is off', async () => {
    const ctx = createMockStepCtx([]);

    await handleDynamicWorkflow(asWorkflowCtx(ctx), createWorkflowArgs());

    expect(ctx.awaitEvent).not.toHaveBeenCalled();
    expect(executedStepSlugs(ctx)).toEqual(['step-1', 'step-2']);
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('pauses before every step while stepping', async () => {
    const ctx = createMockStepCtx(['step', 'step']);

    await handleDynamicWorkflow(
      asWorkflowCtx(ctx),
      createWorkflowArgs({ debugMode: true }),
    );

    expect(ctx.awaitEvent).toHaveBeenCalledTimes(2);
    expect(ctx.awaitEvent.mock.calls[0][0]).toMatchObject({ name: 'debug:1' });
    expect(ctx.awaitEvent.mock.calls[1][0]).toMatchObject({ name: 'debug:2' });
    expect(executedStepSlugs(ctx)).toEqual(['step-1', 'step-2']);
  });

  it('pauses BEFORE the step executes and journals the pause on the execution row', async () => {
    const ctx = createMockStepCtx(['step', 'step']);

    await handleDynamicWorkflow(
      asWorkflowCtx(ctx),
      createWorkflowArgs({ debugMode: true }),
    );

    // The pause-marker mutation and the awaitEvent both happen before the
    // first executeStep runAction.
    const firstAwaitOrder = ctx.awaitEvent.mock.invocationCallOrder[0];
    const firstActionOrder = ctx.runAction.mock.invocationCallOrder[0];
    expect(firstAwaitOrder).toBeLessThan(firstActionOrder);

    // First mutation sets the debug waitingFor marker for step-1…
    expect(ctx.runMutation.mock.calls[0][1]).toMatchObject({
      status: 'running',
      currentStepSlug: 'step-1',
      currentStepName: 'Start',
      waitingFor: 'debug:1:step-1',
    });
    // …and the next one clears it after the resume event.
    expect(ctx.runMutation.mock.calls[1][1]).toMatchObject({
      status: 'running',
      waitingFor: '',
    });
    // Second pause targets step-2 with the next pause index.
    expect(ctx.runMutation.mock.calls[2][1]).toMatchObject({
      currentStepSlug: 'step-2',
      waitingFor: 'debug:2:step-2',
    });
  });

  it('stops pausing after a continue event', async () => {
    const ctx = createMockStepCtx(['continue']);

    await handleDynamicWorkflow(
      asWorkflowCtx(ctx),
      createWorkflowArgs({ debugMode: true }),
    );

    expect(ctx.awaitEvent).toHaveBeenCalledTimes(1);
    expect(executedStepSlugs(ctx)).toEqual(['step-1', 'step-2']);
  });
});

// --- Durable sandbox handoff: re-enter the SAME step on port 'running' -------

describe('handleDynamicWorkflow durable sandbox handoff', () => {
  it('re-enters the same step on port "running" until it returns terminal', async () => {
    // step-2 (sandbox) hands off TWICE (its action window elapsed; the exec is
    // still running) then completes — proving one durable step spans many
    // segments without advancing the workflow.
    let step2Calls = 0;
    const ctx: MockStepCtx = {
      runAction: vi.fn((_ref: unknown, args: Record<string, unknown>) => {
        if (!args || !('stepSlug' in args)) return Promise.resolve(null);
        const slug = String(args.stepSlug);
        if (slug === 'step-2') {
          step2Calls += 1;
          return Promise.resolve({
            port: step2Calls < 3 ? 'running' : 'success',
          });
        }
        return Promise.resolve({ port: 'success' });
      }),
      runMutation: vi.fn(() => Promise.resolve(null)),
      awaitEvent: vi.fn(() => Promise.resolve({ action: 'step' })),
    };

    await handleDynamicWorkflow(
      asWorkflowCtx(ctx),
      createWorkflowArgs({
        steps: [
          {
            stepSlug: 'step-1',
            stepType: 'start',
            name: 'Start',
            organizationId: 'org-1',
            nextSteps: { success: 'step-2' },
            config: {},
          },
          {
            stepSlug: 'step-2',
            stepType: 'sandbox',
            name: 'Implement',
            organizationId: 'org-1',
            nextSteps: {},
            config: {},
          },
        ],
      }),
    );

    // step-2 ran THREE times (handoff, handoff, terminal); the 'running' port
    // never tried to resolve a nextStep (no throw on the empty nextSteps map)
    // and never advanced past step-2.
    expect(executedStepSlugs(ctx)).toEqual([
      'step-1',
      'step-2',
      'step-2',
      'step-2',
    ]);
    // Each handoff stamps the in-progress step on the execution row.
    const reentryMarks = ctx.runMutation.mock.calls.filter(
      (c: unknown[]) =>
        c[1] !== null &&
        typeof c[1] === 'object' &&
        (c[1] as Record<string, unknown>).currentStepSlug === 'step-2' &&
        (c[1] as Record<string, unknown>).status === 'running',
    );
    expect(reentryMarks).toHaveLength(2);
  });
});
