import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import {
  isRunFailureCode,
  NodeFailure,
  RunStopFailure,
  runFailureCodeOf,
} from './failure';

/**
 * The stepper's side of the effect ledger (`app.automation_node_attempts`,
 * written by `domains/automations/node-attempts.ts`): a live run begins every
 * call that reaches outside it — a connector write, a model call — before it
 * makes it, and records how it ended after. On a resumed run the ledger, not
 * the walker's memory, decides whether the call happens again: a finished call
 * is reused, a call that may or may not have happened waits for a person
 * unless it may safely be repeated, and a person's decision is carried out.
 */

/** What reaches outside the run: a connector write or a model call. */
export type AttemptKind = 'connector' | 'llm';

/** What the ledger answers when a walker begins a call. */
export type BeginAttempt =
  /** A `started` row is committed: make the call now. */
  | { kind: 'go'; attempt: number }
  /** An earlier attempt finished: reuse its output, make no call. */
  | { kind: 'done'; output: unknown }
  /** An earlier attempt failed: replay its failure. */
  | { kind: 'failed'; error: string; failureCode: string | null }
  /** An earlier attempt may have happened: park the run for a person. */
  | { kind: 'in_doubt'; attemptId: string; attempt: number }
  /** A person chose to skip it: the step returned nothing. */
  | { kind: 'skip' }
  /** A person chose to fail the run. */
  | { kind: 'fail'; resolvedBy: string }
  /** This walker no longer holds the run. */
  | { kind: 'stale' };

/** Where in a run a call happens: the node's path, its forEach item and its
 * repeat pass. */
export interface CallAddress {
  /** The node's id at the top level, `<parent>[<item>:<pass>]/<id>` inside a
   * subautomation. */
  nodeId: string;
  itemIndex: number;
  pass: number;
}

export interface LedgerCall extends CallAddress {
  kind: AttemptKind;
  nodeType: string;
  /** The resolved input the call is made with — what a person deciding about
   * it reads. */
  input: unknown;
  /** Whether the call may be made again when an earlier attempt's outcome is
   * unknown: a model call (no outside effect, only spend) or an action that
   * declares itself safe to repeat. */
  recallable: boolean;
}

export interface RunLedger {
  begin(call: LedgerCall): Promise<BeginAttempt>;
  finish(
    args: CallAddress & {
      attempt: number;
      status: 'done' | 'failed';
      output?: unknown;
      error?: string;
      failureCode?: string;
    },
  ): Promise<void>;
}

/** The ledger of a mock run, a test or the in-memory executor: every call
 * goes ahead and nothing is recorded. */
export const passThroughLedger: RunLedger = {
  async begin() {
    return { kind: 'go', attempt: 1 };
  },
  async finish() {
    // Nothing recorded: a mock call reaches nothing outside the run.
  },
};

/** The ledger of a durable live run, fenced by the walker's claim epoch. */
export function durableLedger(
  ctx: ActionCtx,
  run: { organizationId: string; runId: string; epoch: number },
): RunLedger {
  return {
    async begin(call) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the handler answers exactly this shape
      return (await ctx.runMutation(
        internal.automations.mutations.beginNodeAttempt,
        { ...run, ...call },
      )) as BeginAttempt;
    },
    async finish(args) {
      await ctx.runMutation(internal.automations.mutations.finishNodeAttempt, {
        organizationId: run.organizationId,
        runId: run.runId,
        ...args,
      });
    },
  };
}

/**
 * The walker no longer holds its run: a newer claim superseded it, or the
 * run ended. Nothing it would do next may happen; the walk unwinds as if the
 * run had been stopped.
 */
export class StaleClaim extends Error {
  constructor() {
    super('this walker no longer holds the run');
    this.name = 'StaleClaim';
  }
}

/**
 * A write this run was making when it was interrupted may already have
 * reached its service, and it may not safely be repeated: the run parks at
 * the top-level node until a person decides. Inside a subautomation it
 * bubbles up to the calling node, which is the one that can park.
 */
export class InDoubtPark extends Error {
  readonly attemptId: string;
  readonly address: CallAddress;

  constructor(attemptId: string, address: CallAddress) {
    super(
      `${address.nodeId} may already have run: a person decides how the run continues`,
    );
    this.name = 'InDoubtPark';
    this.attemptId = attemptId;
    this.address = address;
  }
}

/** A failure's one sentence, as the run detail shows it. */
function failureSentence(error: unknown): string {
  if (error instanceof NodeFailure && error.hint !== undefined) {
    return `${error.message} — ${error.hint}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Make a call through the ledger: begin it, and either carry out what an
 * earlier attempt left (reuse its output, replay its failure, park for a
 * person, carry out their decision) or make it and record how it ended.
 *
 * Recording the end is best-effort: a call whose end could not be recorded
 * stays `started`, which a later walker treats as "may have happened" — the
 * cautious reading — so a failed record is logged rather than allowed to
 * replace what the call itself did.
 *
 * `signal` is the turn's. A call cut by it was interrupted, not failed: its
 * attempt stays `started`, so the next walker calls a model again and asks
 * a person about a write that may already have reached its service — where
 * a recorded failure would replay as the step's own failure. Once it has
 * aborted, no call begins.
 */
export async function callThroughLedger(
  ledger: RunLedger,
  call: LedgerCall,
  make: () => Promise<unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const address: CallAddress = {
    nodeId: call.nodeId,
    itemIndex: call.itemIndex,
    pass: call.pass,
  };
  signal?.throwIfAborted();
  const begun = await ledger.begin(call);
  switch (begun.kind) {
    case 'done':
      return begun.output;
    case 'skip':
      return null;
    case 'failed':
      throw new NodeFailure(
        isRunFailureCode(begun.failureCode) ? begun.failureCode : 'node_error',
        begun.error,
      );
    case 'fail':
      // The run detail names the top-level node already: never the nested
      // path of a write inside a subautomation.
      throw new RunStopFailure(
        'effect_in_doubt',
        'a person chose to fail the run here, since the step may already have run',
      );
    case 'in_doubt':
      throw new InDoubtPark(begun.attemptId, address);
    case 'stale':
      throw new StaleClaim();
    case 'go':
      break;
    default: {
      // Never make a call on an answer this engine cannot read: it may be
      // the ledger saying the call already happened.
      const unreadable: never = begun;
      throw new Error(
        `the effect ledger gave an answer this engine cannot read: ${JSON.stringify(unreadable)}`,
      );
    }
  }
  let output: unknown;
  try {
    output = await make();
  } catch (error) {
    if (signal?.aborted === true) throw error;
    await ledger
      .finish({
        ...address,
        attempt: begun.attempt,
        status: 'failed',
        error: failureSentence(error),
        failureCode: runFailureCodeOf(error),
      })
      .catch((recordError: unknown) =>
        console.warn(
          `[automations] could not record the failed call of ${call.nodeId}:`,
          recordError,
        ),
      );
    throw error;
  }
  await ledger
    .finish({ ...address, attempt: begun.attempt, status: 'done', output })
    .catch((recordError: unknown) =>
      console.warn(
        `[automations] could not record the finished call of ${call.nodeId}:`,
        recordError,
      ),
    );
  return output;
}
