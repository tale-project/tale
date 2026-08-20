/**
 * The kick-time resume decision for TASK agent runs — one pure function the
 * two start schedulers (`kickTaskAgentRun`, `wakeParkedTaskAgentRuns`) share,
 * so the "does the previous harness conversation continue?" rule can never
 * drift between them. Non-node on purpose: the schedulers are mutations and
 * the run host (`agent_run_host.ts`) is `'use node'`, so the rule lives here
 * where both sides can import it.
 *
 * A task is one piece of work: a later kick of the same task should be the
 * next user turn on the SAME harness conversation (`--resume`), not a rebuilt
 * brief pretending to be memory. The handle only binds when it provably
 * belongs to this task's previous run on the SAME agent, harness, and sandbox
 * incarnation — anything else starts fresh on the preserved files.
 */

/** What the schedulers know about the task's latest terminal run. */
export interface KickResumePrevious {
  status: 'settled' | 'failed' | 'cancelled';
  agentId: string;
  harness: string;
  sessionId: string;
  startedAt: number;
  /** The harness conversation id — from the run row's stamp, or (for rows
   * predating the stamp) the caller's fallback read of the run's own session
   * op. Absent when the run died before the harness announced one. */
  agentSessionId?: string;
  /** `sandboxSessions.createdAt` of the incarnation that produced the handle
   * — stamped with it on the run row. Absent on op-fallback rows; those bind
   * on the weaker `createdAt <= startedAt` check (an op row cannot outlive
   * its incarnation — session destroy purges the session's ops). */
  sessionCreatedAt?: number;
}

/** The kick being decided: the CURRENT agent facts + the live session row. */
export interface KickResumeContext {
  agentId: string;
  harness: string;
  sessionId: string;
  /** `createdAt` of the live (creating|active|stopped) standing-session row,
   * absent when none exists — a fresh incarnation will be created and no
   * prior conversation can live in it. */
  liveSessionCreatedAt?: number;
}

/**
 * What the start consumes. `resume` + `sessionCreatedAt` travel into
 * `startTaskAgentTurn`, which re-checks the stamp after the session ensure
 * and drops the handle on mismatch. `sweep` and `inspectNote` describe the
 * FRESH path only — the primary one when `resume` is absent, the fallback
 * when a `--resume` start cannot launch (they are exactly the no-handle
 * decision for the same predecessor, so a downgrade never sweeps work the
 * handle was protecting).
 */
export interface TaskKickStartPlan {
  resume?: string;
  sessionCreatedAt?: number;
  /** Fresh path: clear the task's leftover delivery box before the turn. */
  sweep: boolean;
  /** Fresh path: prefix the brief with the inspect-the-box restart note. */
  inspectNote: boolean;
}

/** Handle sanity: harness-announced ids are parsed CLI stdout, so a value a
 * misbehaving process forged must never reach an argv. One conservative
 * shape for every harness (UUIDs, `ses_…`-style ids): no whitespace, no
 * leading dash, bounded length. */
const RESUME_HANDLE_RE = /^[A-Za-z0-9][\w.-]{7,127}$/;

export function isValidResumeHandle(handle: string): boolean {
  return RESUME_HANDLE_RE.test(handle);
}

/**
 * Decide how the next run of this task starts. `previous` is the task's
 * latest terminal run BY THIS AGENT that actually LAUNCHED an exec (the
 * caller skips runs that died before launching — a start that never spawned
 * says nothing about the box or the conversation — and runs of other agents:
 * their box lives in another session, so their status must not decide this
 * session's sweep); null when this agent never ran the task. A parked,
 * never-started run being woken is `queued`, so a terminal-only lookup
 * naturally decides on its predecessor, not on itself.
 *
 * Never derive the handle from "the latest conversation on the standing
 * session": the session is per AGENT and two tasks can run on it at once —
 * session-latest can resume the sibling task's conversation and write into
 * its delivery box. Only the per-task run row (or its own op row) is a valid
 * source, which is why this function takes facts, not a session to scan.
 */
export function resolveTaskKickResume(args: {
  previous: KickResumePrevious | null;
  kick: KickResumeContext;
}): TaskKickStartPlan {
  const { previous, kick } = args;
  if (
    previous === null ||
    // Belt-and-braces against a caller feeding a cross-agent/session row:
    // another session's run tells nothing about THIS session's box — treat
    // as a first start rather than letting a foreign status drive the sweep.
    previous.agentId !== kick.agentId ||
    previous.sessionId !== kick.sessionId
  ) {
    // First start: nothing to resume, nothing in the box (sweep is a no-op
    // that also clears any legacy loose files).
    return { sweep: true, inspectNote: false };
  }

  // The fresh-path shape for THIS predecessor — used directly when the handle
  // does not bind, and carried as the fallback when it does. A settled
  // predecessor's leftovers were already harvested onto `task.outputs`, so
  // the box is safe to sweep; a failed/cancelled one may hold the ONLY copy
  // of unpublished work — keep the box and tell the fresh conversation to
  // inspect it.
  const fresh: TaskKickStartPlan =
    previous.status === 'settled'
      ? { sweep: true, inspectNote: false }
      : { sweep: false, inspectNote: true };

  const handle = previous.agentSessionId;
  if (handle === undefined || !isValidResumeHandle(handle)) return fresh;
  // A harness edit keeps the session (same agent) but a foreign CLI cannot
  // continue this CLI's conversation — fresh, still shaped by the status
  // (the box is this session's and may hold the only copy).
  if (previous.harness !== kick.harness) return fresh;
  const live = kick.liveSessionCreatedAt;
  if (live === undefined) return fresh;
  // Same incarnation? A stamped row must match exactly (destroy → new row →
  // new createdAt → fresh). An op-fallback row has no stamp: its op row
  // existing at all already proves the incarnation (ops are purged on
  // destroy); the `createdAt <= startedAt` bound is belt-and-braces against
  // a recreated row racing the read.
  const sameIncarnation =
    previous.sessionCreatedAt !== undefined
      ? live === previous.sessionCreatedAt
      : live <= previous.startedAt;
  if (!sameIncarnation) return fresh;

  return {
    resume: handle,
    sessionCreatedAt: live,
    sweep: fresh.sweep,
    inspectNote: fresh.inspectNote,
  };
}
