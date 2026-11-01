/**
 * The ledger port: a live run begins every call that reaches outside it — a
 * connector write, a model call — before it makes it, and records how it
 * ended after. On a resumed run the ledger, not the walker's memory, decides
 * whether the call happens again: a finished call is reused, a call that may
 * or may not have happened waits for a person unless it may safely be
 * repeated, and a person's decision is carried out.
 *
 * Types and the pass-through only, in a leaf (`selftest/purity.test.ts`):
 * the durable ledger (`backend/core/automations/ledger.ts`) keeps the port on
 * `app.automation_node_attempts`.
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
