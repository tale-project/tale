// Platform-side mutations for persistent sandbox sessions.
//
// The spawner owns the container/Pod lifecycle and is org-aware only; these
// mutations own the platform record (`sandboxSessions`), the per-owner +
// per-org concurrency gate, the session virtual-key bookkeeping
// (`sandboxSessionTokens`), the in-session progress rows
// (`sandboxSessionOps`), and the credential-access audit
// (`sandboxCredentialAccess`). Mirrors the one-shot `internal_mutations.ts`
// reserve/watchdog pattern.

import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';
import {
  SANDBOX_MAX_SESSIONS_PER_OWNER,
  SANDBOX_SESSION_MAX_LIFETIME_MS,
} from './sessions_schema';
import { sandboxSessionProfileValidator } from './wire';

// Sessions are per-user (one persistent sandbox per user), so this org cap
// should not bind before the spawner's host-RAM cap (SANDBOX_MAX_SESSIONS) —
// keep it high enough that ~one sandbox per active user in an org is allowed.
const SANDBOX_MAX_SESSIONS_PER_ORG = 50;

/**
 * Atomically check the per-owner + per-org active-session caps and insert a
 * `creating` row. Serializable OCC makes the count-then-insert race-free, the
 * same property `reserveSlotAndInsert` relies on for one-shot quota.
 */
export const reserveSessionSlotAndInsert = internalMutation({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    profile: sandboxSessionProfileValidator,
    ownerType: v.string(),
    ownerId: v.string(),
    createdBy: v.string(),
    agentKind: v.optional(v.string()),
    ttlMs: v.optional(v.number()),
  },
  returns: v.id('sandboxSessions'),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Per-owner cap (default 1 active session per thread/workflow-run/user).
    let ownerActive = 0;
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_owner', (q) =>
        q.eq('ownerType', args.ownerType).eq('ownerId', args.ownerId),
      )) {
      if (row.status === 'creating' || row.status === 'active') {
        ownerActive += 1;
        if (ownerActive >= SANDBOX_MAX_SESSIONS_PER_OWNER) {
          throw new ConvexError({
            code: 'QUOTA_EXCEEDED',
            message: `This ${args.ownerType} already has an active sandbox session.`,
          });
        }
      }
    }

    // Per-org cap (defense in depth; the spawner enforces its own cap too).
    let orgActive = 0;
    for (const status of ['creating', 'active'] as const) {
      for await (const _row of ctx.db
        .query('sandboxSessions')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', status),
        )) {
        orgActive += 1;
        if (orgActive >= SANDBOX_MAX_SESSIONS_PER_ORG) {
          throw new ConvexError({
            code: 'QUOTA_EXCEEDED',
            message: `At most ${SANDBOX_MAX_SESSIONS_PER_ORG} sandbox sessions can be active for this organization.`,
          });
        }
      }
    }

    const ttlMs = args.ttlMs ?? SANDBOX_SESSION_MAX_LIFETIME_MS;
    return ctx.db.insert('sandboxSessions', {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      profile: args.profile,
      status: 'creating',
      ownerType: args.ownerType,
      ownerId: args.ownerId,
      createdBy: args.createdBy,
      ...(args.agentKind !== undefined && { agentKind: args.agentKind }),
      createdAt: now,
      expiresAt: now + ttlMs,
    });
  },
});

/** Flip a session row to a new lifecycle status (creating → active on
 * runnerd-ready; → degraded/destroyed/expired/failed otherwise). */
export const setSessionStatus = internalMutation({
  args: {
    rowId: v.id('sandboxSessions'),
    status: v.union(
      v.literal('active'),
      v.literal('degraded'),
      v.literal('destroyed'),
      v.literal('expired'),
      v.literal('failed'),
    ),
    bifrostKeyId: v.optional(v.string()),
    lastActivityAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: args.status };
    if (args.bifrostKeyId !== undefined) patch.bifrostKeyId = args.bifrostKeyId;
    if (args.lastActivityAt !== undefined) {
      patch.lastActivityAt = args.lastActivityAt;
    }
    if (args.status === 'destroyed' || args.status === 'expired') {
      patch.destroyedAt = Date.now();
    }
    await ctx.db.patch(args.rowId, patch);
    return null;
  },
});

/**
 * Watchdog: mark sessions past their hard lifetime as `expired` so a leaked
 * row (a throw between reserve and the spawner create returning) can't pin the
 * owner/org cap forever. The actual container teardown + token revoke is the
 * caller's job (an action that reads these and calls the spawner + Bifrost).
 */
export const recoverStuckSessions = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.id('sandboxSessions')),
  handler: async (ctx, args) => {
    const now = Date.now();
    const expired: Id<'sandboxSessions'>[] = [];
    const limit = args.limit ?? 50;
    for (const status of ['creating', 'active', 'degraded'] as const) {
      for await (const row of ctx.db
        .query('sandboxSessions')
        .withIndex('by_status', (q) => q.eq('status', status))) {
        if (now > row.expiresAt) {
          await ctx.db.patch(row._id, {
            status: 'expired',
            destroyedAt: now,
          });
          expired.push(row._id);
          if (expired.length >= limit) return expired;
        }
      }
    }
    return expired;
  },
});

/**
 * Self-heal: mark every active/creating session row for an owner as destroyed.
 * Called when a reused session turns out to be gone spawner-side (the phantom
 * row left after a container was reaped out-of-band) — clearing it lets the
 * next turn (or an in-turn retry) create a fresh session instead of looping on
 * a 404. Returns the count cleared.
 */
export const destroyActiveSessionsByOwner = internalMutation({
  args: { ownerType: v.string(), ownerId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    let cleared = 0;
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_owner', (q) =>
        q.eq('ownerType', args.ownerType).eq('ownerId', args.ownerId),
      )) {
      if (row.status === 'creating' || row.status === 'active') {
        await ctx.db.patch(row._id, { status: 'destroyed', destroyedAt: now });
        cleared += 1;
      }
    }
    return cleared;
  },
});

// --- session virtual-key bookkeeping ---------------------------------------

/** Persist a minted session token's sha256 hash + scope (never the plaintext). */
export const insertSessionToken = internalMutation({
  args: {
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
    expiresAt: v.number(),
  },
  returns: v.id('sandboxSessionTokens'),
  handler: async (ctx, args) =>
    ctx.db.insert('sandboxSessionTokens', {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      tokenHash: args.tokenHash,
      ...(args.bifrostKeyId !== undefined && {
        bifrostKeyId: args.bifrostKeyId,
      }),
      scope: args.scope,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
    }),
});

/** Revoke every token for a session (on destroy / watchdog reap). */
export const revokeTokensForSession = internalMutation({
  args: { sessionId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    let revoked = 0;
    for await (const row of ctx.db
      .query('sandboxSessionTokens')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      if (row.revokedAt === undefined) {
        await ctx.db.patch(row._id, { revokedAt: now });
        revoked += 1;
      }
    }
    return revoked;
  },
});

/**
 * Delete all progress/op rows for a session. Called on teardown so a future
 * session reusing the same deterministic id (`thr-<threadId>`) can't inherit a
 * stale `agentSessionId` (the query also scopes by the new session's createdAt,
 * but purging keeps the table from accumulating dead ops). Returns the count.
 */
export const deleteOpsForSession = internalMutation({
  args: { sessionId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    let deleted = 0;
    for await (const row of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    return deleted;
  },
});

/**
 * Delete a thread's progress/op rows. Per-user sandboxes outlive any single
 * thread, so the thread-delete cascade can't reap the shared session — it
 * prunes just that thread's ops (keyed by threadId) so the table doesn't
 * accumulate after a chat is deleted. Returns the count.
 */
export const deleteOpsForThread = internalMutation({
  args: { threadId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    let deleted = 0;
    for await (const row of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    return deleted;
  },
});

// --- in-session exec progress ----------------------------------------------

/**
 * Upsert the progress row for one in-session exec. The progress-bridge action
 * calls this throttled (text deltas coalesced; tool-use/usage/result events
 * flushed promptly), so any entry point's reactive `useQuery` renders live
 * progress without a mutation storm.
 */
export const upsertSessionOp = internalMutation({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    threadId: v.optional(v.string()),
    execId: v.string(),
    kind: v.string(),
    status: v.union(
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    progressText: v.optional(v.string()),
    recentEvents: v.optional(v.array(v.string())),
    agentSessionId: v.optional(v.string()),
    exitCode: v.optional(v.number()),
    eventLogStorageId: v.optional(v.string()),
    // Durable-job fields (set by the external-agent turn + continuation).
    assistantMessageId: v.optional(v.string()),
    mintedKeyId: v.optional(v.string()),
    userId: v.optional(v.string()),
    modelRef: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    streamId: v.optional(v.string()),
    deadlineMs: v.optional(v.number()),
    heartbeatAt: v.optional(v.number()),
    lastSeq: v.optional(v.number()),
    checkpointStorageId: v.optional(v.string()),
    continuationCount: v.optional(v.number()),
  },
  returns: v.id('sandboxSessionOps'),
  handler: async (ctx, args) => {
    const now = Date.now();
    let existing: Id<'sandboxSessionOps'> | null = null;
    for await (const row of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      if (row.execId === args.execId) {
        existing = row._id;
        break;
      }
    }
    const terminal = args.status !== 'running';
    const patch: Record<string, unknown> = { status: args.status };
    // Optional fields: patch only when provided so a throttled flush that omits
    // them never clobbers a value set at turn start.
    const optional = [
      'progressText',
      'recentEvents',
      'agentSessionId',
      'exitCode',
      'eventLogStorageId',
      'assistantMessageId',
      'mintedKeyId',
      'userId',
      'modelRef',
      'agentSlug',
      'streamId',
      'deadlineMs',
      'heartbeatAt',
      'lastSeq',
      'checkpointStorageId',
      'continuationCount',
    ] as const;
    for (const k of optional) {
      if (args[k] !== undefined) patch[k] = args[k];
    }
    if (terminal) patch.finishedAt = now;

    if (existing) {
      await ctx.db.patch(existing, patch);
      return existing;
    }
    return ctx.db.insert('sandboxSessionOps', {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      execId: args.execId,
      kind: args.kind,
      startedAt: now,
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
      ...(patch as any),
      ...(args.threadId !== undefined && { threadId: args.threadId }),
    });
  },
});

/**
 * Exactly-once finalize claim. Atomically sets `finalizedAt` only if it was
 * unset and returns whether THIS caller won the claim. The action `finally`,
 * the continuation, the recovery watchdog, and cancel all race to finalize a
 * turn; only the winner runs the VK revoke + usage ledger + message finalize.
 * Serializable OCC makes the read-then-set race-free (same property as
 * reserveSessionSlotAndInsert).
 */
export const claimSessionOpFinalize = internalMutation({
  args: { sessionId: v.string(), execId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    for await (const row of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      if (row.execId !== args.execId) continue;
      if (row.finalizedAt !== undefined) return false; // already finalized
      await ctx.db.patch(row._id, { finalizedAt: Date.now() });
      return true;
    }
    return false; // op row gone → nothing to finalize
  },
});

/** Audit a Tier-2 credential broker fetch. */
export const recordCredentialAccess = internalMutation({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    slug: v.string(),
    kind: v.union(v.literal('bootstrap'), v.literal('git')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('sandboxCredentialAccess', {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      slug: args.slug,
      kind: args.kind,
      fetchedAt: Date.now(),
    });
    return null;
  },
});
