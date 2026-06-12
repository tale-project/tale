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
  /** Throttled live state for the UI (last text delta + recent tool events). */
  progressText: v.optional(v.string()),
  recentEvents: v.optional(v.array(v.string())),
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
})
  .index('by_sessionId', ['sessionId'])
  .index('by_threadId', ['threadId'])
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  // Watchdog: scan `running` ops by heartbeat to find abandoned turns.
  .index('by_status_and_heartbeat', ['status', 'heartbeatAt']);

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
] as const;

export function isLiveSessionStatus(
  status: string,
): status is (typeof SANDBOX_SESSION_LIVE_STATUSES)[number] {
  return (SANDBOX_SESSION_LIVE_STATUSES as readonly string[]).includes(status);
}
