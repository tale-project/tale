// Persistent-session platform tables (sessions plan, milestone A + B + composition).
//
// Separate file from sandbox/schema.ts (the one-shot audit table) so the
// session subsystem's tables + constants stay grouped. All three are
// additive; the one-shot `sandboxExecutions` table is untouched.

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { sandboxSessionProfileValidator } from './wire';

/**
 * One row per persistent sandbox session. The spawner owns the
 * container/Pod lifecycle and is org-aware only; the OWNER (thread /
 * workflow run / user) lives here on the platform side and drives lifecycle
 * cascade, access control, UI placement, and per-owner quota.
 *
 * ownerType is an open string set (not a v.union of literals) so a future
 * owner entity — a project, an automation — needs no schema migration; the
 * validator stays permissive and the application layer enumerates.
 *
 * Indexes:
 *   by_organizationId_and_status — per-org concurrent-session cap (reserve)
 *   by_owner                     — owner lifecycle cascade (thread delete /
 *                                  archive / erasure, workflow-run end)
 *   by_status                    — watchdog reconcile across all orgs
 */
export const sandboxSessionsTable = defineTable({
  organizationId: v.string(),
  /** Spawner-side session id (also the container/Pod name seed). */
  sessionId: v.string(),
  profile: sandboxSessionProfileValidator,
  status: v.union(
    v.literal('creating'),
    v.literal('active'),
    v.literal('degraded'),
    // Compute released (container/Pod stopped by the idle/TTL reaper) but the
    // workspace is PRESERVED — resumable on the next turn. Not terminal; data
    // is removed only by an explicit 'destroyed'.
    v.literal('stopped'),
    v.literal('destroyed'),
    v.literal('expired'),
    v.literal('failed'),
  ),
  // Polymorphic owner (open set — see note above).
  ownerType: v.string(), // 'thread' | 'workflow_run' | 'user' | …
  ownerId: v.string(),
  createdBy: v.string(),
  agentKind: v.optional(v.string()), // 'claude-code' | 'opencode' | …
  /** Bifrost virtual-key id (NOT the plaintext key). */
  bifrostKeyId: v.optional(v.string()),
  createdAt: v.number(),
  expiresAt: v.number(),
  lastActivityAt: v.optional(v.number()),
  destroyedAt: v.optional(v.number()),
  /** "Always-on": exempt from the idle reaper + the hard TTL (platform side
   * raises expiresAt; the spawner reaper skips it). Opt-in per session from the
   * sandbox-management page, so the warm-container cost is bounded. */
  pinned: v.optional(v.boolean()),
  pinnedAt: v.optional(v.number()),
})
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  .index('by_owner', ['ownerType', 'ownerId'])
  .index('by_status', ['status'])
  .index('by_sessionId', ['sessionId']);

/**
 * Session-scoped LLM gateway token (the Bifrost virtual key) — only the
 * sha256 hash is persisted. Scope bounds what the in-sandbox agent can do;
 * revoked on session destroy / watchdog reap.
 */
export const sandboxSessionTokensTable = defineTable({
  organizationId: v.string(),
  sessionId: v.string(),
  tokenHash: v.string(),
  bifrostKeyId: v.optional(v.string()),
  scope: v.object({
    agentKind: v.string(),
    allowedModels: v.array(v.string()),
    integrationGrants: v.array(v.string()),
    budgetCents: v.number(),
  }),
  createdAt: v.number(),
  expiresAt: v.number(),
  revokedAt: v.optional(v.number()),
})
  .index('by_tokenHash', ['tokenHash'])
  .index('by_sessionId', ['sessionId'])
  .index('by_organizationId', ['organizationId']);

/**
 * In-session exec / progress rows. Deliberately NOT the quota-bearing
 * `sandboxExecutions` table (daily-CPU-seconds budgeting doesn't map to
 * long-lived sessions). One row per exec; the reactive progress model writes
 * throttled AgentEvent state here so any entry point's `useQuery` renders
 * live progress. Full event logs that would exceed the 1 MB doc cap roll into
 * `_storage` (eventLogStorageId).
 */
export const sandboxSessionOpsTable = defineTable({
  organizationId: v.string(),
  sessionId: v.string(),
  /** The chat thread this op ran for. A per-user sandbox serves many threads
   * from one session, so resume + the live-progress query scope by thread, not
   * just sessionId. Optional for pre-per-user rows + non-chat (exec) ops. */
  threadId: v.optional(v.string()),
  execId: v.string(),
  kind: v.string(), // 'exec' | 'agent-run'
  status: v.union(
    v.literal('running'),
    v.literal('completed'),
    v.literal('failed'),
    v.literal('cancelled'),
  ),
  /** Throttled live state for the UI (last text delta). */
  progressText: v.optional(v.string()),
  /** @deprecated No longer written. The live tool/reasoning timeline now renders
   *  from the persisted assistant message (run_agent `onTimeline`), not from a
   *  parallel op buffer. Kept optional so legacy rows still pass the read
   *  validator. */
  recentEvents: v.optional(v.array(v.string())),
  /** Live tool/reasoning transcript for a WORKFLOW-RUN step, in the AI-SDK
   *  UI-part shape `buildMessageSegments` reads. The chat path renders this from
   *  the persisted assistant message, but a workflow run has no message — so its
   *  run view reads a bounded tail (recent N parts) from here. Written only for
   *  threadId-less workflow ops; dies with the op at teardown. */
  liveTimeline: v.optional(
    v.array(
      v.object({
        type: v.string(),
        text: v.optional(v.string()),
        state: v.optional(v.string()),
        toolCallId: v.optional(v.string()),
        input: v.optional(v.any()),
        output: v.optional(v.any()),
        errorText: v.optional(v.string()),
      }),
    ),
  ),
  /** Captured agent session id so the next turn can --resume / -s. */
  agentSessionId: v.optional(v.string()),
  exitCode: v.optional(v.number()),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  eventLogStorageId: v.optional(v.string()),
  // --- durable-job fields (connection-independent turns) -------------------
  // Enough for the cross-action continuation to resume and for the recovery
  // watchdog to finalize a turn whose action died, exactly-once. All optional
  // + additive (existing rows validate; non-agent execs leave them unset).
  /** The streaming assistant message this turn patches/finalizes. */
  assistantMessageId: v.optional(v.string()),
  /** Bifrost virtual-key id to revoke on finalize (spend attribution). */
  mintedKeyId: v.optional(v.string()),
  /** Usage-attribution + finalize context for a recovery-path finalize. */
  userId: v.optional(v.string()),
  modelRef: v.optional(v.string()),
  agentSlug: v.optional(v.string()),
  /** Generation stream id — recovery clears the thread's generation status. */
  streamId: v.optional(v.string()),
  /** Absolute deadline for the whole turn; recovery treats `running` past this
   * (with a stale heartbeat) as abandoned. */
  deadlineMs: v.optional(v.number()),
  /** Last drain heartbeat — distinguishes a live draining action from a dead
   * one (the watchdog only reaps rows whose heartbeat went stale). */
  heartbeatAt: v.optional(v.number()),
  /** When the agent last emitted a stream event. Diverges from heartbeatAt
   * when the CLI is alive but silent (e.g. idle-waiting on an in-session
   * background task) — the UI uses the gap to label the tail indicator
   * honestly instead of showing "Thinking" forever. */
  lastEventAt: v.optional(v.number()),
  /** Set while the exec is LINGERING: its per-turn agent result has arrived
   * but the stream-json process is alive (held-open stdin), waiting on
   * background tasks or steer messages. steer_delivery skips file staging in
   * this state — the drain's linger loop delivers via stdin instead (a file
   * staged into a lingering exec would sit unconsumed: no tool/stop
   * boundaries fire while the model idles). Cleared when activity resumes. */
  agentIdleAt: v.optional(v.number()),
  /** Resume cursor: highest runnerd event seq consumed (for the continuation
   * action to re-attach without missing/duplicating events). */
  lastSeq: v.optional(v.number()),
  /** _storage id of the turn checkpoint (the accumulated AgentEvent timeline)
   * the continuation action re-loads to resume building the message. */
  checkpointStorageId: v.optional(v.string()),
  /** Set exactly once when the turn's side-effects (VK revoke + usage ledger +
   * message finalize) have run — guards against duplicate finalization across
   * the action, the continuation, recovery, and cancel. */
  finalizedAt: v.optional(v.number()),
  /** How many cross-action handoffs this turn has done (runaway cap). */
  continuationCount: v.optional(v.number()),
  /** Cumulative in-task LLM spend (cents) polled from the turn's Bifrost VK,
   * stamped at each continuation seam so the management page can show live
   * rolling spend without polling the gateway from a reactive query. */
  spentCents: v.optional(v.number()),
  /** Set when the turn stopped at a seam for a non-error reason — currently
   * 'budget' (the org's rolling cap was reached). Distinguishes a clean
   * budget pause from a completed/failed/cancelled op on the management page. */
  pausedReason: v.optional(v.string()),
  /** @deprecated Steer seams now trip on the OBSERVED injection (Stop-hook
   * stream sentinel / consumed.* dir poll), with the delivered queue rows as
   * the pending signal — a single re-stampable timestamp could lose a second
   * steer's seam. markDelivered still writes this for the deploy window only
   * (in-flight pre-deploy actions consume it via the old per-flush poll);
   * nothing in new code reads it. A stale stamp on a terminal op row is dead,
   * exec-scoped data purged with the op. Remove with the next schema sweep. */
  steerSeamRequestedAt: v.optional(v.number()),
  /** The agent's OWN self-reported terminal status from its `result` event
   * (e.g. 'completed' | 'error_max_turns' | ...), stamped at the drain's
   * terminal write. The restorative recovery path prefers this over a bare exec
   * exit code so a turn the agent itself completed is never marked failed. */
  agentResultStatus: v.optional(v.string()),
  /** Provenance of the latest (re)attach: 'initial' | 'handoff' | 'watchdog' |
   * 'thread-open'. Observability only — lets the management page + logs tell a
   * normal seam handoff from a crash-recovery resume. */
  resumedBy: v.optional(v.string()),
})
  .index('by_sessionId', ['sessionId'])
  .index('by_threadId', ['threadId'])
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  // Point lookup of one exec within a session (upsert/finalize/resume/spend/
  // steer), avoiding an O(ops-in-session) by_sessionId scan + execId filter on
  // the 500ms progress-flush hot path.
  .index('by_sessionId_and_execId', ['sessionId', 'execId'])
  // Watchdog: scan `running` ops by heartbeat to find abandoned turns.
  .index('by_status_and_heartbeat', ['status', 'heartbeatAt'])
  // Latest agent-run op for a thread (live-progress read): eq(threadId, kind) +
  // order('desc') on startedAt → O(1) most-recent, replacing an
  // O(ops-in-thread) scan that re-ran on every reactive tick.
  .index('by_threadId_kind_and_startedAt', ['threadId', 'kind', 'startedAt']);

/**
 * Resume checkpoint for a DURABLE workflow `sandbox`-step agent run. A single
 * `sandbox` step can outlast the 10-min Convex action ceiling: each action runs
 * one attach-window over the continuously-running exec, hands off with status
 * 'running', and the durable workflow handler re-enters the SAME step — the next
 * action re-attaches from this cursor. (The exec never stops; only the
 * platform's attach is segmented.)
 *
 * Unlike the chat path (whose checkpoint is a `_storage` timeline blob, needed
 * to RENDER the message across segments), a workflow sandbox run renders no
 * timeline — it only needs the tiny, bounded re-attach cursor. So it lives
 * INLINE here. One row per session (deterministic `sessionIdForWorkflowRun`):
 * written on each handoff, read by the next segment, deleted on the terminal
 * segment (and by the stale-session reaper).
 */
export const sandboxAgentCheckpointsTable = defineTable({
  organizationId: v.string(),
  sessionId: v.string(),
  execId: v.string(),
  /** Re-attach cursor → `runAgentInSessionImpl` `resumeFrom`. */
  lastSeq: v.number(),
  agentSessionId: v.optional(v.string()),
  /** stdin-hold lifecycle carried across the seam (claude-code linger loop):
   * without these the next segment could EOF a process whose pending background
   * tasks it never saw start (the re-attach replays only events after lastSeq). */
  agentResultSeen: v.optional(v.boolean()),
  agentIdle: v.optional(v.boolean()),
  pendingTaskIds: v.optional(v.array(v.string())),
  /** Stalled-turn watchdog: an earlier segment's stream surfaced a terminal
   * API/stream error. Carried so a wedge that straddles the seam (the CLI printed
   * the error then sat on its held-open stdin with no result and no exit) is still
   * force-closed on resume instead of looping empty handoffs to the budget. */
  apiErrorSeen: v.optional(v.boolean()),
  /** The admitted `taskAgentRuns` row for a task-bound durable agent run.
   * Admission happens ONCE on the fresh segment; the runId is carried here so
   * resume segments re-use it and never re-admit (which would double-count the
   * concurrency counter). Absent for non-task sandbox steps. */
  taskRunId: v.optional(v.id('taskAgentRuns')),
  /** Cumulative-budget tracking ACROSS segments: the step's `maxWallClockMs` is
   * a hard total cap, independent of any single action window. */
  startedAt: v.number(),
  continuationCount: v.number(),
  updatedAt: v.number(),
}).index('by_sessionId', ['sessionId']);

/**
 * Audit row for every Tier-2 credential fetch (the integration-credential
 * broker), so a session's use of a granted GitHub/etc. token is traceable.
 */
export const sandboxCredentialAccessTable = defineTable({
  organizationId: v.string(),
  sessionId: v.string(),
  slug: v.string(),
  kind: v.union(v.literal('bootstrap'), v.literal('git')),
  fetchedAt: v.number(),
})
  .index('by_sessionId', ['sessionId'])
  .index('by_organizationId', ['organizationId']);

/**
 * Audit row for every agent-initiated integration DISPATCH call (the in-sandbox
 * MCP bridge → /api/integrations/execute). Forensic trail for the otherwise
 * unmetered read surface: who/what/when/outcome and a sorted param-KEY
 * fingerprint, never param values or secrets. Distinct from
 * sandboxCredentialAccessTable (Tier-2 git/bootstrap credential fetches).
 */
export const sandboxIntegrationCallsTable = defineTable({
  organizationId: v.string(),
  sessionId: v.string(),
  slug: v.string(),
  operation: v.string(),
  operationType: v.optional(v.string()), // 'read' | 'write' (best-effort)
  userId: v.optional(v.string()),
  // 'ok' | 'unavailable' | 'requires_approval' | 'error' | 'rate_limited'
  outcome: v.string(),
  /** Sorted param KEYS (never values) for debugging a misfire. */
  paramsFingerprint: v.optional(v.string()),
  calledAt: v.number(),
})
  .index('by_sessionId', ['sessionId'])
  .index('by_organizationId', ['organizationId']);

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

/**
 * User-level environment variables + secrets, auto-attached to all of this
 * user's sandbox sessions in the org. One row per (organizationId, userId,
 * key). Non-secret vars keep `value` in plaintext; secrets keep
 * `encryptedValue` (a compact JWE from `lib/crypto/encryptString`) and never
 * expose the value back through the read API (write-only). Injected into the
 * running container via `sessionEnvPatch` at turn start (managed AND byo
 * sessions) — it's the user's box environment, and where a BYO agent's own
 * credentials (e.g. its own API key) live.
 */
export const sandboxUserEnvTable = defineTable({
  organizationId: v.string(),
  userId: v.string(),
  /** Environment variable name (validated `^[A-Za-z_][A-Za-z0-9_]*$`). */
  key: v.string(),
  isSecret: v.boolean(),
  /** Plaintext value for non-secret vars; omitted for secrets. */
  value: v.optional(v.string()),
  /** Compact JWE ciphertext for secrets; omitted for non-secret vars. */
  encryptedValue: v.optional(v.string()),
  updatedAt: v.number(),
  updatedBy: v.string(),
})
  .index('by_org_user', ['organizationId', 'userId'])
  .index('by_org_user_key', ['organizationId', 'userId', 'key']);
