/**
 * A subautomation is one step of its parent run, and a step that fails
 * inside it fails the parent with the inner step's own cause: a reached
 * budget stays `budget_exceeded` — re-read from the sentence it was
 * `node_error`, which counts toward a schedule's pause — and an authoring
 * error stays `node_error`. The llm door is a stand-in; the walk is real.
 */

import { beforeEach, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';

const refusal = vi.hoisted(() => ({
  message:
    "the llm call was refused: Usage limit reached. The organization's monthly cost limit is used up until 2026-11-01T00:00:00.000Z.",
  hint: 'wait until the limit resets, or ask an administrator to raise it',
}));

vi.mock('./llm_call', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./llm_call')>()),
  automationLlmCall: () => async () => {
    const { NodeFailure: Failure } = await import('./failure.ts');
    throw new Failure('budget_exceeded', refusal.message, refusal.hint);
  },
}));

const { stepRunImpl } = await import('./stepper.ts');

const PARENT = {
  name: 'ops/parent',
  nodes: [{ id: 'delegate', type: 'subautomation', automation: 'ops/child' }],
  output: '{{ nodes.delegate.output }}',
};

let child: Record<string, unknown>;
let finished: Record<string, unknown> | undefined;

const ctx = {
  runQuery: async (ref: unknown) => {
    const name = functionRefName(ref);
    if (name === 'automations/queries:loadAutomationDocument') {
      return { document: child };
    }
    return {
      run: { name: 'ops/parent', mode: 'live', input: {}, checkpoints: null },
      document: PARENT,
    };
  },
  runMutation: async (ref: unknown, args: Record<string, unknown>) => {
    const name = functionRefName(ref);
    if (name.endsWith(':claimRun')) return { claimed: true, epoch: 1 };
    if (name.endsWith(':finishRun')) {
      finished = args;
      return { status: args.status };
    }
    // A model call goes through the effect ledger first.
    if (name.endsWith(':beginNodeAttempt')) return { kind: 'go', attempt: 1 };
    if (name.endsWith(':finishNodeAttempt')) return { recorded: true };
    return { status: 'running' };
  },
};

beforeEach(() => {
  finished = undefined;
});

it('fails the parent with budget_exceeded when an llm step inside a subautomation is refused [GOV-R4]', async () => {
  child = {
    name: 'ops/child',
    nodes: [
      { id: 'summarize', type: 'llm', model: 'vendor/small-1', prompt: 'x' },
    ],
    output: '{{ nodes.summarize.output }}',
  };

  await expect(
    stepRunImpl(ctx as never, { organizationId: 'org-1', runId: 'run-1' }),
  ).resolves.toEqual({ status: 'failed' });

  expect(finished).toMatchObject({
    status: 'failed',
    failureCode: 'budget_exceeded',
    detail: `delegate: subautomation "ops/child" failed: ${refusal.message} — ${refusal.hint}`,
  });
});

it('keeps an authoring error inside a subautomation a node_error', async () => {
  child = {
    name: 'ops/child',
    nodes: [{ id: 'shape', type: 'transform', code: 'return missing.value;' }],
    output: '{{ nodes.shape.output }}',
  };

  await expect(
    stepRunImpl(ctx as never, { organizationId: 'org-1', runId: 'run-1' }),
  ).resolves.toEqual({ status: 'failed' });

  expect(finished).toMatchObject({
    status: 'failed',
    failureCode: 'node_error',
    detail:
      'delegate: subautomation "ops/child" failed: ReferenceError: missing is not defined',
  });
});
