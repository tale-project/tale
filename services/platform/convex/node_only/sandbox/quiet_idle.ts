// Quiet-idle decision for the external-agent linger loop (run_agent.ts).
//
// A claude-code turn driven over held-open stream-json stdin is "idle" — and
// thus a place to push a queued steer message — not only when its per-turn
// result arrives, but also when the main loop has gone quiet while parked on
// background work. Three distinct parked postures exist, and each was a
// delivery blind spot when the gating got it wrong, so the decision lives here
// as a pure function with direct unit coverage:
//
//   'background' : a background task is pending and NO main-level tool is in
//                  flight. With inflightToolUses === 0 the last main event is
//                  necessarily a completed text OR tool-result (a dangling
//                  tool-use would keep the set non-empty), either of which
//                  means the model has parked on the task.
//   'waittool'   : a background task is pending and the ONLY main-level tools
//                  in flight are blocking task reads (TaskOutput block=true) —
//                  the model issued a blocking read and is waiting on it.
//   'subagent'   : the main loop spawned Task sub-agent(s) and went quiet
//                  awaiting them — no task_* ledger entry; the blocker is the
//                  inflight Task tool(s).
//
// All three require QUIET_IDLE_MS of main-loop silence; the caller excludes
// background task_* chatter and sub-agent traffic from lastMainActivityAt, so
// the debounce reflects genuine main-loop silence. Acting on a false positive
// is lossless — a stdin line pushed while the model is actually mid-step is
// queued by the CLI to its next API boundary, exactly like interactive
// steering. A false negative re-creates the unsteerable blind spot, so the
// gating errs toward firing.

export type QuietIdlePosture = 'none' | 'background' | 'waittool' | 'subagent';

export interface QuietIdleInputs {
  /** Already flagged idle — nothing to (re-)decide. */
  agentIdle: boolean;
  /** Per-turn result already seen — idle is handled on the result path. */
  agentResultSeen: boolean;
  /** Background-task ledger depth (task_started minus task_settled). */
  pendingTasks: number;
  /** Main-level tool-uses awaiting a tool-result. */
  inflightToolUses: number;
  /** Subset of inflightToolUses that are Task sub-agent spawns. */
  inflightSubAgents: number;
  /** Subset of inflightToolUses that are blocking task reads (TaskOutput). */
  inflightWaitTools: number;
  /** When the main loop last produced non-background, non-subagent output. */
  lastMainActivityAt: number;
  now: number;
  quietIdleMs: number;
}

/**
 * Which parked posture (if any) the main loop is in. Returns 'none' unless the
 * main loop has been silent for >= quietIdleMs AND a parked posture matches.
 * The postures are mutually exclusive (a tool is a Task xor a TaskOutput xor
 * other work; 'background' requires zero inflight tools), so order is for
 * readability only.
 */
export function quietIdleDecision(s: QuietIdleInputs): QuietIdlePosture {
  if (s.agentIdle || s.agentResultSeen) return 'none';
  if (s.now - s.lastMainActivityAt < s.quietIdleMs) return 'none';
  if (s.pendingTasks > 0 && s.inflightToolUses === 0) return 'background';
  if (
    s.pendingTasks > 0 &&
    s.inflightWaitTools > 0 &&
    s.inflightToolUses === s.inflightWaitTools
  ) {
    return 'waittool';
  }
  if (s.inflightSubAgents > 0 && s.inflightToolUses === s.inflightSubAgents) {
    return 'subagent';
  }
  return 'none';
}
