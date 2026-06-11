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
})
  .index('by_sessionId', ['sessionId'])
  .index('by_threadId', ['threadId'])
  .index('by_organizationId_and_status', ['organizationId', 'status']);

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
