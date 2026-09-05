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

/** The kind the task-agent host files its turn ops under. */
export const TASK_AGENT_OP_KIND: SandboxAgentOpKind = 'task-agent';
/** The kind the automation agent host files its turn ops under. */
export const WORKFLOW_AGENT_OP_KIND: SandboxAgentOpKind = 'workflow-agent';

/** Per-owner concurrent-session cap (org cap lives spawner-side too). */
export const SANDBOX_MAX_SESSIONS_PER_OWNER = 1;
export const SANDBOX_SESSION_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;

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
