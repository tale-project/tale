/**
 * Deterministic name of the workflow event that wakes a parked sandbox step
 * waiting on capacity. A parked durable step does `step.awaitEvent({ name })`;
 * a slot-release / reconciler `sendEvent`s the SAME name to resume it. The name
 * is per-(execution, step) but NOT per-park: a spurious/duplicate wake is SAFE —
 * buffered event delivery + the atomic reserve mean an extra wake just costs one
 * cheap reserve attempt that re-parks if the org is still full.
 */
export function sandboxCapacityWakeEventName(
  wfExecutionId: string,
  stepSlug: string,
): string {
  return `sandbox_capacity:${wfExecutionId}:${stepSlug}`;
}

/**
 * The `kind` an agent-turn op row carries in `app.sandbox_session_ops`: the
 * task-agent host writes `task-agent`, the automation agent host writes
 * `workflow-agent`. Every reader that folds "the agent turns" (the external-
 * turn metrics, the harness-health hint) and every writer that creates an op
 * row outside the hosts (the re-attach sweeps) must speak this vocabulary —
 * a row filed under any other kind is invisible to the run-card and metric
 * reads.
 */
export const SANDBOX_AGENT_OP_KINDS = ['task-agent', 'workflow-agent'] as const;

export type SandboxAgentOpKind = (typeof SANDBOX_AGENT_OP_KINDS)[number];

/** Per-owner concurrent-session cap (org cap lives spawner-side too). */
export const SANDBOX_MAX_SESSIONS_PER_OWNER = 1;
export const SANDBOX_SESSION_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const SANDBOX_SESSION_MAX_IDLE_MS = 30 * 60 * 1000;

/**
 * Statuses under which a session row is LIVE: the incarnation the reused
 * deterministic sessionId currently refers to, and the rows the management
 * page lists / its controls act on. Terminal rows (destroyed | expired |
 * failed) are historical incarnations kept for audit — the by_sessionId index
 * yields them oldest-first, so every sessionId-keyed read/patch must skip them.
 *
 * NOT the same set as the reuse/quota checks (creating|active — a degraded
 * sandbox isn't reused and doesn't hold the cap) or the owner-cascade teardown
 * (which includes `failed` to reap leaked containers).
 */
export const SANDBOX_SESSION_LIVE_STATUSES = [
  'creating',
  'active',
  'degraded',
  // Hibernated (compute released, workspace preserved) — still a LIVE
  // incarnation: the management page lists it, sessionId-keyed reads/patches
  // act on it, and the next turn resumes it in place (same createdAt).
  'stopped',
] as const;

export function isLiveSessionStatus(
  status: string,
): status is (typeof SANDBOX_SESSION_LIVE_STATUSES)[number] {
  return (SANDBOX_SESSION_LIVE_STATUSES as readonly string[]).includes(status);
}
