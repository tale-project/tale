/**
 * The run record: what a run did at each step, kept so a person can see why
 * it took the path it took — what each step received and returned, which
 * condition held and with what values, how long it waited and for whom, how
 * often it was tried, and why it failed.
 *
 * One record per unit of work: a step (`item`/`pass` -1), one item of a
 * step that runs per item, or one pass of a step that repeats. The run's
 * input and its document output have records of their own, at the reserved
 * paths {@link START_PATH} and {@link END_PATH}.
 *
 * Pure and browser-safe: the engine writes these and the app reads them,
 * through the same types.
 */

import type { SchemaTreeSchema } from '@tale/ui/data/infer-schema';
import type { ValueSummary } from '@tale/ui/data/value-summary';

import type { Json } from '../types';
import type { StepFailureReason } from './failure';

/** Where in a run a unit sits. `item`/`pass` are -1 when the step does not
 * run per item / does not repeat. */
export interface UnitKey {
  path: string;
  item: number;
  pass: number;
}

/** The run's input, as the reserved Start step of the canvas. */
export const START_PATH = '__start';
/** The document's `output` expression, as the reserved End step. */
export const END_PATH = '__end';

/** One place a value was withheld or cut, by RFC 6901 pointer into it. */
export interface ValueElision {
  pointer: string;
  /** `string`: characters dropped from its end; `items`: list entries
   * dropped; `depth`: a value past the depth limit, now `null`, with its size
   * as UTF-8 JSON; `whole`: even cut, the value was past its tier's ceiling,
   * so nothing of it was kept — `dropped` is the cut value's size (the whole
   * value's is the record's `bytes`). */
  kind: 'string' | 'items' | 'depth' | 'whole';
  dropped: number;
}

/** A place a secret was withheld from. */
export interface ValueRedaction {
  pointer: string;
  /** `key`: its member name marks a secret, and the value there is `null`;
   * `pattern`: the text looked like a credential, and is `null`; `name`: a
   * member of the object there was left out, because its name looked like
   * a credential or was too long to show. */
  why: 'key' | 'pattern' | 'name';
}

/**
 * A recorded value: secrets withheld first; then summarized, shaped and
 * hashed from the whole withheld value; then cut to its tier's limits, every
 * cut listed beside it rather than written into it.
 */
export interface ValueRecord {
  /** Absent when the run's budget for stored values is spent, or the value
   * was `undefined`. */
  value?: Json;
  summary: ValueSummary;
  /** Read from the whole value; lists carry `x-count`. */
  shape: SchemaTreeSchema;
  /** The whole value's size as UTF-8 JSON. */
  bytes: number;
  /** cyrb53 of the whole value as key-sorted JSON; `null` above
   * {@link RECORD_HASH_MAX_BYTES}. */
  hash: string | null;
  elided?: ValueElision[];
  redacted?: ValueRedaction[];
  /** How many places were cut or withheld when there were more than the
   * lists keep: a reader cannot tell which values past the listed ones are
   * real, so it reads the value as partly unknown. */
  elidedTotal?: number;
  redactedTotal?: number;
}

/** Values above this size as JSON are not hashed: 4 MiB. */
export const RECORD_HASH_MAX_BYTES = 4 * 1024 * 1024;

/** One evaluation of a condition or template field: per `{{ }}` unit (or the
 * bare expression) the value of every evaluated sub-expression, keyed by its
 * UTF-16 range in the field's text. */
export interface EvalUnitTrace {
  range: [number, number];
  probes: Array<{ range: [number, number]; v: ValueSummary }>;
  error?: { message: string; name?: string };
  /** `none`: the expression ran without probes (too large, or the runner
   * cannot probe), so only its result is known. */
  probed: 'full' | 'none';
}

export interface EvalTrace {
  /** RFC 6901 pointer into the version's document. */
  pointer: string;
  units: EvalUnitTrace[];
}

/** Why a step ran, was skipped, or ran as often as it did; the latest
 * evaluation of each kind. `at` is epoch ms. */
export type Decision =
  | {
      kind: 'when';
      result: boolean;
      value: ValueSummary;
      trace: EvalTrace;
      at: number;
    }
  | {
      kind: 'else';
      partner: string;
      partnerSkippedByWhen: boolean;
      result: boolean;
      at: number;
    }
  | { kind: 'upstream'; skipped: string[]; at: number }
  | {
      kind: 'forEach';
      count: number;
      value: ValueSummary;
      trace: EvalTrace;
      at: number;
    }
  | {
      kind: 'repeatUntil';
      pass: number;
      result: boolean;
      capped: boolean;
      value: ValueSummary;
      trace: EvalTrace;
      at: number;
    }
  | { kind: 'onError'; policy: 'continue'; at: number };

/** Parameters a failure reason is explained with: secrets withheld, each at
 * most {@link FAILURE_PARAM_LENGTH} characters. */
export type FailureParams = Record<
  string,
  string | number | boolean | null | readonly string[]
>;

export const FAILURE_PARAM_LENGTH = 200;

export interface StepFailure {
  /** The run-level family (`Run.failureCode`); a string here because the
   * family's list lives with the durable runtime, not the engine. */
  code: string;
  /** A newer server may answer a reason this reader does not know. */
  reason: StepFailureReason | (string & {});
  params: FailureParams;
  /** The engine's English (`message — hint`), for technical details only. */
  message: string;
  hint?: string;
  at?: { pointer: string; range?: [number, number] };
  /** The failing expression's sub-expression values, when it was evaluated
   * again to explain the failure. */
  trace?: EvalTrace;
}

export interface WaitRecord {
  kind: 'approval' | 'ask' | 'room' | 'repeat' | 'in_doubt';
  since: number;
  until?: number;
  /** The approval or attempt the wait was for. */
  ref?: string;
  outcome?:
    | 'approved'
    | 'rejected'
    | 'answered'
    | 'expired'
    | 'retry'
    | 'skip'
    | 'fail';
  /** The member who decided (approval, in doubt). */
  by?: string;
}

export interface AttemptRecord {
  n: number;
  startedAt: number;
  endedAt?: number;
  outcome: 'interrupted' | 'retried' | 'failed' | 'ok';
  failureCode?: string;
  reason?: string;
}

/** What a stored record says. */
export type UnitStatus = 'running' | 'waiting' | 'ok' | 'skipped' | 'failed';

/** What every read answers: the stored status, completed with what the run
 * as a whole says (a step a stopped run never reached is `not_run`). */
export type ViewStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'stopped'
  | 'not_run'
  | 'reused';

/** Attempts kept per unit; older ones drop first. */
export const RECORD_MAX_ATTEMPTS = 10;
/** Waits kept per unit; the rest merge into the last. */
export const RECORD_MAX_WAITS = 20;

export interface NodeRunRecord {
  key: UnitKey;
  nodeId: string;
  /** `input` for {@link START_PATH}, `output` for {@link END_PATH}. */
  nodeType: string;
  status: UnitStatus;
  /** Epoch ms, by the clock of the process that ran it. */
  startedAt?: number;
  endedAt?: number;
  /** Time spent working, summed over the turns it ran in. */
  activeMs: number;
  attempt: number;
  attempts: AttemptRecord[];
  skip?: { reason: 'when' | 'else' | 'upstream' | 'error'; via?: string[] };
  failure?: StepFailure;
  input?: ValueRecord;
  output?: ValueRecord;
  decisions: Decision[];
  waits: WaitRecord[];
  counts?: {
    items: number;
    ok: number;
    failed: number;
    skipped: number;
    passes?: number;
    kept: number;
  };
  meta: {
    docRef?: string;
    pins?: Record<string, number>;
    execId?: string;
    model?: string;
    connector?: string;
    action?: string;
    effect?: 'read' | 'write';
    idempotencyKey?: string;
    approvalId?: string;
    /** For each templated text field (by pointer, such as `/nodes/3/prompt`)
     * the span each `{{ }}` unit rendered to in the stored text. */
    rendered?: Record<
      string,
      Array<{ unit: [number, number]; out: [number, number] }>
    >;
    /** The step's result was taken from an earlier run, not run again. */
    reused?: { runId: string; startedAt?: number; endedAt?: number };
    /** Reserved for test benches: how the step was stood in for. */
    bench?: string;
    whenWouldSkip?: true;
  };
}
