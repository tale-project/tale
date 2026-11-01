/**
 * The ports a run's walk is driven through, whichever host walks it: where
 * its progress goes, and the human gate before an effect. The ledger's port
 * is `./ledger`; the run record's is `RunRecorder` (`../record/recorder`).
 *
 * Types and the in-memory sink only, in a leaf (`selftest/purity.test.ts`).
 */

import type { NodeCheckpoint, NodeCursor } from './progress';

/** What the walk does with a finished node, a wait, and a spent budget. The
 * durable sink persists and reschedules; the inline sink (a `subautomation`
 * node's own nodes) keeps everything in memory and never suspends. */
export interface RunSink {
  /** Persist one finished node, or just the in-node cursor. Returns the run's
   * status so cancellation stops the walk at the next node boundary. */
  commit(args: {
    nodeId?: string;
    checkpoint?: NodeCheckpoint;
    cursor?: NodeCursor;
    executions: number;
  }): Promise<'running' | 'cancelled'>;
  /** Park the run. `continue` means the caller should loop in place instead —
   * what an inline sub-run does, matching the in-memory executor. `event`
   * records why the run parked when its park string says too little. */
  wait(args: {
    detail: string;
    cursor?: NodeCursor;
    executions: number;
    resumeInMs: number;
    event?: { kind: 'in_doubt'; detail: Record<string, unknown> };
  }): Promise<'suspended' | 'continue' | 'cancelled'>;
  /** Whether this turn should stop and let a fresh invocation continue: its
   * budget is spent, or its server is stopping. */
  shouldHandOff(): boolean;
  /** Hand the run to the scheduler — with a note when its server is
   * stopping, so the run is counted and shown as resumed after a restart. */
  handOff(note?: HandOffNote): Promise<void>;
  /** Whether `wait` can actually park the run. False for the inline sink: a
   * step that would have to park (an agent turn, an approval) refuses BEFORE
   * it spends anything, instead of discovering `continue` after the kick. */
  canPark: boolean;
}

/** Why a walker handed its run on before it was done, when the reason is its
 * server stopping (the store's `RunHandoff`). A hand-off because the turn's
 * budget ran out carries none. */
export interface HandOffNote {
  reason: 'shutdown';
  /** The node the walker was in, and its forEach item. */
  nodeId?: string;
  itemIndex?: number;
  /** The node's body was cut off mid-call rather than finished. */
  interrupted?: boolean;
}

export const inlineSink: RunSink = {
  async commit() {
    return 'running';
  },
  async wait() {
    return 'continue';
  },
  canPark: false,
  shouldHandOff() {
    return false;
  },
  async handOff() {
    // Nothing to hand off: a sub-run is one step of its parent.
  },
};

/**
 * The human gate a live effectful node passes through before it touches the
 * outside world.
 *
 * A seam rather than an inline call so the approvals domain stays out of the
 * walk's imports and so a test can drive suspension and resume without it.
 * Every run carries its own gate on its run context, built for the run's own
 * organization when its turn starts (`automationApprovalGate` in
 * `backend/core/automations/stepper.ts`).
 */
export interface AutomationApprovalGate {
  check(request: {
    organizationId: string;
    automation: string;
    runId: string;
    nodeId: string;
    nodeType: string;
    /** Whether the caller can park on a card. False inside a subautomation:
     * the gate then answers from the policy alone and mints nothing — and
     * reads nothing, so a card a parent-level node of the same id once had
     * approved never releases a sub-node. */
    canPark: boolean;
    /** The node's input resolved against the run's scope — what the step
     * would call the connector with, for the approver to read before
     * deciding. Absent when it cannot be resolved ahead of the step (a loop
     * body reads `item`/`index`, which exist only once the loop turns). */
    input?: unknown;
  }): Promise<
    { status: 'allowed' } | { status: 'required'; approvalId?: string }
  >;
}
