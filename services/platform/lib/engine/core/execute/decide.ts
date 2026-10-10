/**
 * The decisions both executors make the same way: whether a step runs or is
 * skipped, which list a `forEach` step runs over, and whether a
 * `repeatUntil` pass settled the step. The in-process executor and the
 * durable stepper call these and nothing else, so a run reads the same
 * however it was carried out — the notes they leave in the trace included,
 * word for word.
 *
 * With a recorder that keeps a record, each decision is recorded on the
 * unit it was made for, with the values the condition read; without one the
 * conditions evaluate plainly, as they always did.
 */

import { kindOf } from '@tale/ui/data/value-summary';

import type { RunRecorder } from '../record/recorder';
import type { UnitKey } from '../record/types';
import { recordedSummary } from '../record/value';
import {
  evalCondition,
  evalConditionTraced,
  evalTemplates,
  evalTemplateTraced,
  ExprError,
} from '../template';
import type { NodeDef } from '../types';
import { refsOf } from './controlflow';
import { makeScope } from './scope';

/** What the walk knows when it reaches a step. */
export interface WalkState {
  outputs: Record<string, { output: unknown }>;
  /** Steps whose skipping propagates to the steps reading them. */
  skipped: ReadonlySet<string>;
  /** Steps their own `when` skipped — what `elseOf` consults. */
  whenSkipped: ReadonlySet<string>;
  /** A step's place in the walk, so a skip names the first skipped step it
   * reads from; source order when absent. */
  rank?: (nodeId: string) => number;
}

/** Where a step sits: its unit and its pointer in the document
 * (`/nodes/3`). */
export interface StepAt {
  key: UnitKey;
  pointer: string;
}

export type NodeDecision =
  | { kind: 'run' }
  | {
      kind: 'skip';
      reason: 'upstream' | 'else' | 'when';
      /** The skipped steps it reads from, first in walk order. */
      via?: string[];
      /** The trace note, as both executors have always written it. */
      note: string;
    };

/**
 * Whether `node` runs, by the skip rules in their order: a step reading
 * from a skipped step is skipped; an `elseOf` step runs only when its
 * partner's own `when` skipped it; then the step's own `when`.
 */
export async function decideNode(
  node: NodeDef,
  input: unknown,
  state: WalkState,
  at: StepAt,
  rec: RunRecorder,
): Promise<NodeDecision> {
  const upstream = [...refsOf(node).data].filter((ref) =>
    state.skipped.has(ref),
  );
  if (upstream.length > 0) {
    const rank = state.rank;
    const via =
      rank === undefined
        ? upstream
        : upstream.toSorted((a, b) => rank(a) - rank(b));
    rec.decision(at.key, { kind: 'upstream', skipped: via });
    return {
      kind: 'skip',
      reason: 'upstream',
      via,
      note: `skipped: reads from skipped node(s) ${upstream.join(', ')}`,
    };
  }
  if (typeof node.elseOf === 'string') {
    const partnerSkippedByWhen = state.whenSkipped.has(node.elseOf);
    rec.decision(at.key, {
      kind: 'else',
      partner: node.elseOf,
      partnerSkippedByWhen,
      result: partnerSkippedByWhen,
    });
    if (!partnerSkippedByWhen) {
      return {
        kind: 'skip',
        reason: 'else',
        note: `skipped: elseOf partner "${node.elseOf}" ran`,
      };
    }
  }
  if (typeof node.when === 'string') {
    const scope = makeScope(input, state.outputs);
    const pointer = `${at.pointer}/when`;
    let value: unknown;
    if (rec.enabled) {
      const traced = await evalConditionTraced(node.when, scope, pointer);
      value = traced.value;
      rec.decision(at.key, {
        kind: 'when',
        result: Boolean(value),
        value: recordedSummary(value),
        trace: traced.trace,
      });
    } else {
      value = await evalCondition(node.when, scope, pointer);
    }
    if (!value) {
      return {
        kind: 'skip',
        reason: 'when',
        note: `skipped: when=${JSON.stringify(node.when)} was falsy`,
      };
    }
  }
  return { kind: 'run' };
}

/**
 * The list a `forEach` step runs over (`forEach` is the step's field).
 * Anything but a list fails the step
 * (`FOREACH_NOT_LIST`), in the words both executors have always used.
 */
export async function resolveForEach(
  forEach: string,
  input: unknown,
  state: Pick<WalkState, 'outputs'>,
  at: StepAt,
  rec: RunRecorder,
): Promise<unknown[]> {
  const scope = makeScope(input, state.outputs);
  const pointer = `${at.pointer}/forEach`;
  const traced = rec.enabled
    ? await evalTemplateTraced(forEach, scope, pointer)
    : { value: await evalTemplates(forEach, scope, pointer) };
  const resolved = traced.value;
  if (!Array.isArray(resolved)) {
    const range =
      'trace' in traced && traced.trace.units.length === 1
        ? traced.trace.units[0]?.range
        : undefined;
    throw new ExprError(
      forEach,
      `forEach must resolve to an array, got ${resolved === undefined ? 'undefined' : typeof resolved} — check the referenced path`,
      {
        reason: 'FOREACH_NOT_LIST',
        params: { expr: forEach, kind: kindOf(resolved) },
        at: { pointer, ...(range !== undefined && { range }) },
        ...('trace' in traced && { trace: traced.trace }),
      },
    );
  }
  if ('trace' in traced) {
    rec.decision(at.key, {
      kind: 'forEach',
      count: resolved.length,
      value: recordedSummary(resolved),
      trace: traced.trace,
    });
  }
  return resolved;
}

/**
 * Whether a pass of a `repeatUntil` step settled it (`repeatUntil` is the
 * step's field; `pass.index` counts from 0): the
 * condition reads the pass's output both as `output` and as the step's own
 * `nodes.<id>.output`. Recorded on the pass's unit, with whether the step
 * ran out of passes.
 */
export async function repeatSettled(
  node: NodeDef,
  repeatUntil: string,
  input: unknown,
  state: Pick<WalkState, 'outputs'>,
  pass: {
    key: UnitKey;
    pointer: string;
    index: number;
    max: number;
    extra: Record<string, unknown>;
    output: unknown;
  },
  rec: RunRecorder,
): Promise<boolean> {
  const withSelf = { ...state.outputs, [node.id]: { output: pass.output } };
  const scope = makeScope(input, withSelf, {
    ...pass.extra,
    output: pass.output,
  });
  const pointer = `${pass.pointer}/repeatUntil`;
  if (!rec.enabled) {
    return Boolean(await evalCondition(repeatUntil, scope, pointer));
  }
  const traced = await evalConditionTraced(repeatUntil, scope, pointer);
  const result = Boolean(traced.value);
  rec.decision(pass.key, {
    kind: 'repeatUntil',
    pass: pass.index,
    result,
    capped: !result && pass.index + 1 >= pass.max,
    value: recordedSummary(traced.value),
    trace: traced.trace,
  });
  return result;
}
