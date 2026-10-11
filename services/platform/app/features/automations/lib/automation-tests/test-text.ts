/**
 * A test's result as a person reads it, in the session's language: one
 * sentence per failure (`tests.failure.<kind>` in the `automations`
 * catalog), the line a row of the Tests panel shows, the duration, and
 * which nodes the test stands in for. The engine's own English stays in
 * the technical details.
 */

import type { z } from 'zod';

import type { StepFailure } from '@/lib/engine/core/record/types';
import type { testFailureSchema } from '@/lib/shared/schemas/automation-tests';

import { nodeTitle } from '../node-face';
import { stepFailureText } from '../run-failure';
import type { StoredTestResult, TestRunResult } from './test-results';

/** A failure as a run of tests answers it. */
export type TestFailureView = z.infer<typeof testFailureSchema>;

/** A failure as a kept report holds it: whole, or past the report's size
 * its kind alone. */
export type AnyTestFailure = TestFailureView | { kind: string };

export interface TestTextContext {
  /** The session's translate function; every key here names its
   * namespace. */
  t: (key: string, options?: Record<string, unknown>) => string;
  locale: string;
  /** A node's name as the canvas titles it; its id in words by default. */
  nodeLabel?: (id: string) => string;
  /** An action as the catalog names it ("GitHub · Create issue"); the
   * node type as written by default. */
  effectLabel?: (connector: string) => string;
}

/** A key of the `automations` catalog, in the session's language. */
function say(
  ctx: TestTextContext,
  key: string,
  values: Record<string, unknown> = {},
): string {
  return ctx.t(key, { ...values, ns: 'automations' });
}

function labelOf(ctx: TestTextContext, node: string | undefined): string {
  if (node === undefined || node === '') return 'none';
  return (ctx.nodeLabel ?? nodeTitle)(node);
}

/** A failure that carries its facts, not its kind alone. */
export function isWholeFailure(
  failure: AnyTestFailure,
): failure is TestFailureView {
  switch (failure.kind) {
    case 'refused':
      return 'issues' in failure;
    case 'run_failed':
    case 'failed_elsewhere':
      return 'message' in failure;
    case 'run_succeeded':
      return 'expected' in failure;
    case 'failure_message':
      return 'actual' in failure;
    case 'output':
      return 'mode' in failure;
    case 'effect_missing':
    case 'effect_present':
      return 'connector' in failure;
    case 'node_state':
      return 'node' in failure;
    case 'timeout':
      return 'limitMs' in failure;
    default:
      return false;
  }
}

/** Why the run failed, in the run view's words: the step failure's title,
 * or nothing when the failure carries no reason to word. */
function runFailureReason(
  failure: Extract<TestFailureView, { kind: 'run_failed' }>,
  ctx: TestTextContext,
): string | undefined {
  if (failure.failure === undefined) return undefined;
  const step: StepFailure = { ...failure.failure, message: failure.message };
  const text = stepFailureText(step, { t: ctx.t, locale: ctx.locale });
  return text.known ? text.title : undefined;
}

/** One sentence for one failure. A failure a kept report holds by its kind
 * alone, or of a kind this build does not know, reads as "didn't pass". */
export function failureSentence(
  failure: AnyTestFailure,
  ctx: TestTextContext,
): string {
  if (!isWholeFailure(failure)) return say(ctx, 'tests.failure.unknown');
  const effect = (connector: string) =>
    (ctx.effectLabel ?? ((id: string) => id))(connector);
  switch (failure.kind) {
    case 'output':
      return say(
        ctx,
        failure.mode === 'includes'
          ? 'tests.failure.outputIncludes'
          : 'tests.failure.output',
        { count: Math.max(1, failure.total) },
      );
    case 'effect_missing':
      return say(ctx, 'tests.failure.effect_missing', {
        action: effect(failure.connector),
        node: labelOf(ctx, failure.node),
      });
    case 'effect_present':
      return say(ctx, 'tests.failure.effect_present', {
        action: effect(failure.connector),
        node: labelOf(ctx, failure.node),
      });
    case 'node_state':
      return say(ctx, 'tests.failure.node_state', {
        node: labelOf(ctx, failure.node),
        expected: failure.expected,
        actual: failure.actual,
      });
    case 'run_failed': {
      const reason = runFailureReason(failure, ctx);
      const node = labelOf(ctx, failure.node);
      return reason === undefined
        ? say(ctx, 'tests.failure.run_failedPlain', { node })
        : say(ctx, 'tests.failure.run_failed', { node, reason });
    }
    case 'run_succeeded':
      return say(ctx, 'tests.failure.run_succeeded', {
        node: labelOf(ctx, failure.expected.node),
      });
    case 'failed_elsewhere':
      return say(ctx, 'tests.failure.failed_elsewhere', {
        expected: labelOf(ctx, failure.expectedNode),
        actual: labelOf(ctx, failure.actualNode),
      });
    case 'failure_message':
      return say(ctx, 'tests.failure.failure_message', {
        node: labelOf(ctx, failure.node),
      });
    case 'refused':
      return say(ctx, 'tests.failure.refused', {
        count: Math.max(1, failure.issues.length),
      });
    case 'timeout':
      return say(ctx, 'tests.failure.timeout', {
        seconds: Math.max(1, Math.round(failure.limitMs / 1000)),
      });
  }
  // Every kind is worded above; one a newer server adds reads as this.
  return say(ctx, 'tests.failure.unknown');
}

/** The line under a test's name: its first failure, in words. None for a
 * test that passed. */
export function resultReason(
  result: TestRunResult | StoredTestResult,
  ctx: TestTextContext,
): string | undefined {
  if (result.pass) return undefined;
  const [first] = result.failures ?? [];
  return first === undefined
    ? say(ctx, 'tests.failure.unknown')
    : failureSentence(first, ctx);
}

/** How long a test's run took, as the row's trailing figure. */
export function durationText(ms: number, ctx: TestTextContext): string {
  return say(ctx, 'tests.duration', { ms: Math.max(0, Math.round(ms)) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keysOf(value: unknown): number {
  return isRecord(value) ? Object.keys(value).length : 0;
}

/** The chips a test's row carries: how many nodes it simulates the output
 * of, and how many it makes fail. */
export function testBadges(test: unknown, ctx: TestTextContext): string[] {
  if (!isRecord(test)) return [];
  const simulated = keysOf(test.mocks);
  const failing = keysOf(test.failures);
  return [
    ...(simulated > 0
      ? [say(ctx, 'tests.badges.simulates', { count: simulated })]
      : []),
    ...(failing > 0
      ? [say(ctx, 'tests.badges.failures', { count: failing })]
      : []),
  ];
}
