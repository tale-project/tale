// Platform-side mutations for persistent sandbox sessions.
//
// The spawner owns the container/Pod lifecycle and is org-aware only; these
// mutations own the platform record (`sandboxSessions`), the per-owner +
// per-org concurrency gate, the session virtual-key bookkeeping
// (`sandboxSessionTokens`), the in-session progress rows
// (`sandboxSessionOps`), and the credential-access audit
// (`sandboxCredentialAccess`). Mirrors the one-shot `internal_mutations.ts`
// reserve/watchdog pattern.

import type { WithoutSystemFields } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { isE2ECronSuppressed } from '../lib/e2e_cron_guard';
import {
  type AdmissionTicketArgs,
  assertFifoEligible,
  claimTicket,
  reserveTicketArg,
  upsertWaitingTicket,
} from './admission';
import {
  readSandboxQuotaPolicy,
  sessionBudgetForOwnerType,
  sessionCapFor,
} from './quota_policy';
import { workflowExecutionOwnerId } from './session_naming';
import {
  isLiveSessionStatus,
  SANDBOX_MAX_SESSIONS_PER_OWNER,
  SANDBOX_SESSION_LIVE_STATUSES,
  SANDBOX_SESSION_MAX_LIFETIME_MS,
} from './sessions_schema';
import { sandboxSessionProfileValidator } from './wire';

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
    // Park-on-capacity: when present, the per-org cap becomes a FIFO queue —
    // this caller already polled `pollAdmission` and is claiming a freed slot.
    ticket: v.optional(reserveTicketArg),
  },
  returns: v.id('sandboxSessions'),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Per-owner cap (default 1 active session per thread/workflow-run/user). A
    // real conflict (this owner already holds a live session), NOT a capacity
    // wait — so it throws QUOTA_EXCEEDED even in parking mode.
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

    // Per-org cap. In PARKING mode (a ticket is present) the cap is a FIFO queue:
    // `assertFifoEligible` throws WAIT_FIFO (caller re-parks) unless this ticket
    // is at the front of an open slot; we then claim it in THIS txn so the slot
    // count + the claim are one serializable transaction. Without a ticket the
    // legacy hard-cap throw (QUOTA_EXCEEDED) is unchanged.
    if (args.ticket) {
      const ticketArgs: AdmissionTicketArgs = {
        organizationId: args.organizationId,
        kind: 'session',
        ownerType: args.ownerType,
        ownerId: args.ownerId,
        source: args.ticket.source,
        ...(args.ticket.threadId !== undefined && {
          threadId: args.ticket.threadId,
        }),
        ...(args.ticket.wfExecutionId !== undefined && {
          wfExecutionId: args.ticket.wfExecutionId,
        }),
        ...(args.ticket.stepSlug !== undefined && {
          stepSlug: args.ticket.stepSlug,
        }),
      };
      const ticketCreatedAt = await upsertWaitingTicket(ctx, ticketArgs, now);
      await assertFifoEligible(
        ctx,
        args.organizationId,
        'session',
        ticketCreatedAt,
        sessionBudgetForOwnerType(args.ownerType),
      );
      await claimTicket(ctx, args.ownerType, args.ownerId, now);
    } else {
      // Per-org cap (defense in depth; the spawner enforces its own cap too).
      // The three session workloads (user agent / thread run_code / workflow)
      // are limited separately, so count + cap only this owner's budget.
      const quota = await readSandboxQuotaPolicy(ctx.db, args.organizationId);
      const budget = sessionBudgetForOwnerType(args.ownerType);
      const cap = sessionCapFor(budget, quota);
      let orgActive = 0;
      for (const status of ['creating', 'active'] as const) {
        for await (const row of ctx.db
          .query('sandboxSessions')
          .withIndex('by_organizationId_and_status', (q) =>
            q.eq('organizationId', args.organizationId).eq('status', status),
          )) {
          if (sessionBudgetForOwnerType(row.ownerType) !== budget) continue;
          orgActive += 1;
          if (orgActive >= cap) {
            throw new ConvexError({
              code: 'QUOTA_EXCEEDED',
              message: `At most ${cap} ${budget} sandbox sessions can be active for this organization.`,
            });
          }
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

/**
 * Best-effort: schedule an instant capacity wake of one FIFO-head session
 * waiter after this org freed a session slot, so a parked workflow sandbox step
 * resumes immediately instead of waiting for the reconciler tick. Scheduled (not
 * called inline) so a wake failure can never fail the slot-release mutation, and
 * via the scheduler ref so sandbox/* never imports workflow_engine/engine by
 * value (no import cycle). No-op when the org id is empty (can't queue a wake).
 */
async function scheduleSessionCapacityWake(
  ctx: MutationCtx,
  organizationId: string,
): Promise<void> {
  if (!organizationId) return;
  // The head-waiter wake targeted workflow-engine waiters parked on
  // sandbox capacity. That engine is offline while it is rebuilt and no
  // workflow waiters exist, so there is nothing to wake.
  console.debug(
    `[sandbox] capacity wake skipped (org ${organizationId}) — no workflow waiters while the automation engine is rebuilt`,
  );
}

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
    llmGatewayKeyId: v.optional(v.string()),
    lastActivityAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: args.status };
    if (args.llmGatewayKeyId !== undefined)
      patch.llmGatewayKeyId = args.llmGatewayKeyId;
    if (args.lastActivityAt !== undefined) {
      patch.lastActivityAt = args.lastActivityAt;
    }
    if (args.status === 'destroyed' || args.status === 'expired') {
      patch.destroyedAt = Date.now();
    }
    await ctx.db.patch(args.rowId, patch);
    // A destroyed/expired session frees a per-org session slot → wake a waiter.
    if (args.status === 'destroyed' || args.status === 'expired') {
      const row = await ctx.db.get(args.rowId);
      if (row) await scheduleSessionCapacityWake(ctx, row.organizationId);
    }
    return null;
  },
});

// A pinned ("always-on") session shouldn't expire platform-side — push its
// expiresAt far out (the spawner reaper is exempted separately).
const PINNED_LIFETIME_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * Pin / unpin a session ("always-on"). Pinned: raise expiresAt far out so the
 * platform watchdog won't expire it. Unpinned: give it a fresh normal lifetime.
 * The spawner-side reaper exemption is pushed separately (sessionSetPinned).
 */
export const setSessionPinned = internalMutation({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    pinned: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      // Org-scoped like its siblings (markSessionRowDestroyed/Stopped): the
      // deterministic spawner sessionId travels through the browser, so never
      // touch a row from another tenant even if the id were guessed.
      if (row.organizationId !== args.organizationId) continue;
      // The deterministic per-(org,user) sessionId is reused across
      // create/destroy cycles, so `by_sessionId` returns many historical rows.
      // Pin only the LIVE one — pinning a stale `failed`/`destroyed` record is
      // meaningless and would leak a pinned dead row onto the management page.
      if (!isLiveSessionStatus(row.status)) continue;
      await ctx.db.patch(row._id, {
        pinned: args.pinned,
        pinnedAt: args.pinned ? now : undefined,
        expiresAt: args.pinned
          ? now + PINNED_LIFETIME_MS
          : now + SANDBOX_SESSION_MAX_LIFETIME_MS,
      });
    }
    return null;
  },
});

/**
 * Watchdog: mark sessions past their hard lifetime as `expired` so a leaked
 * row (a throw between reserve and the spawner create returning) can't pin the
 * owner/org cap forever. The actual container teardown + token revoke is the
 * caller's job (an action that reads these and calls the spawner + the gateway).
 *
 * `stopped` rows are EXEMPT: a hibernated session's workspace is preserved
 * indefinitely until an explicit Destroy (it holds no compute and doesn't pin
 * the RAM-oriented org cap), so the TTL must never auto-expire it.
 */
export const recoverStuckSessions = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.id('sandboxSessions')),
  handler: async (ctx, args) => {
    if (isE2ECronSuppressed()) return [];
    const now = Date.now();
    const expired: Id<'sandboxSessions'>[] = [];
    // Spawner-side ids of the rows this sweep expired — their gateway VKs are
    // revoked out-of-band (a mutation can't call the gateway).
    const expiredSessionIds: string[] = [];
    // Distinct orgs that had a session slot freed by this sweep — wake each once
    // at the end (deduped so expiring many rows can't fan out into many wakes).
    const freedOrgs = new Set<string>();
    const limit = args.limit ?? 50;
    for (const status of SANDBOX_SESSION_LIVE_STATUSES) {
      if (status === 'stopped') continue;
      for await (const row of ctx.db
        .query('sandboxSessions')
        .withIndex('by_status', (q) => q.eq('status', status))) {
        if (now > row.expiresAt) {
          // Never expire a session with a RUNNING agent-run op: an unbounded
          // turn legitimately outlives the 24h lifetime, and expiring the row
          // would orphan the live exec + break per-user workspace continuity.
          // (The spawner already exempts liveExecs>0 container-side; this is the
          // platform-row mirror. A genuinely dead exec is bounded by its sliding
          // deadline, after which no running op remains and the row ages out.)
          let hasRunningAgentRun = false;
          for await (const op of ctx.db
            .query('sandboxSessionOps')
            .withIndex('by_sessionId', (q) =>
              q.eq('sessionId', row.sessionId),
            )) {
            if (op.kind === 'agent-run' && op.status === 'running') {
              hasRunningAgentRun = true;
              break;
            }
          }
          if (hasRunningAgentRun) continue;
          await ctx.db.patch(row._id, {
            status: 'expired',
            destroyedAt: now,
          });
          expired.push(row._id);
          expiredSessionIds.push(row.sessionId);
          if (row.organizationId) freedOrgs.add(row.organizationId);
          if (expired.length >= limit) break;
        }
      }
      if (expired.length >= limit) break;
    }
    // An expired session drops out of the (creating|active) in-flight count, so
    // it frees a per-org session slot → wake a parked waiter (same as the
    // destroy/stop controls), not just on the next reconciler tick.
    for (const organizationId of freedOrgs) {
      await scheduleSessionCapacityWake(ctx, organizationId);
    }
    // Revoke the expired sessions' gateway VKs out-of-band — the row flip alone
    // leaves a spendable credential live (the leak this closes). Workspace +
    // container are left to the spawner's idle reaper (expiry preserves state).
    if (expiredSessionIds.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.node_only.sandbox.session_teardown.teardownExpiredSessions,
        { sessionIds: expiredSessionIds },
      );
    }
    return expired;
  },
});

/** Mark the LIVE session row(s) for a sessionId destroyed, scoped to its org
 * (the management-page Destroy control). Org-guarded so a control call can't
 * touch another tenant's session even if the spawner id were guessed. The
 * reused deterministic sessionId makes by_sessionId yield historical terminal
 * rows oldest-first — skip them (an early return on one would leave the live
 * row untouched). Returns whether any row flipped. */
export const markSessionRowDestroyed = internalMutation({
  args: { organizationId: v.string(), sessionId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const now = Date.now();
    let destroyed = false;
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      if (row.organizationId !== args.organizationId) continue;
      if (!isLiveSessionStatus(row.status)) continue;
      await ctx.db.patch(row._id, { status: 'destroyed', destroyedAt: now });
      destroyed = true;
    }
    // A freed per-org session slot → wake a parked waiter immediately.
    if (destroyed) await scheduleSessionCapacityWake(ctx, args.organizationId);
    return destroyed;
  },
});

/**
 * Row-flip half of the end-of-turn thread-session teardown: mark every live
 * `thread`-owned row of the thread `destroyed`, wake capacity waiters, and
 * schedule the out-of-band VK/op cleanup (whose sessionDestroy re-run is an
 * idempotent no-op). Called by `teardownThreadSessionAtTurnEnd` ONLY AFTER
 * the spawner confirmed the conditional (`if_idle`) destroy — never flip a
 * row while the container may survive with a live exec. Thread sessions are
 * TURN-scoped by design — one session amortizes the turn's run_code calls,
 * but it must not linger as idle compute once the turn ends; the next turn
 * recreates it and re-stages the workspace from `threadFiles`. A turn that
 * ran no run_code finds no live row and schedules nothing. Idempotent
 * against a concurrent reaper/cascade.
 */
export const destroyThreadOwnedSessions = internalMutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const sessionIds: string[] = [];
    const orgIds = new Set<string>();
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_owner', (q) =>
        q.eq('ownerType', 'thread').eq('ownerId', args.threadId),
      )) {
      if (!isLiveSessionStatus(row.status)) continue;
      await ctx.db.patch(row._id, { status: 'destroyed', destroyedAt: now });
      sessionIds.push(row.sessionId);
      orgIds.add(row.organizationId);
    }
    if (sessionIds.length === 0) return null;
    // Freed per-org session slots → wake parked waiters immediately.
    for (const organizationId of orgIds) {
      await scheduleSessionCapacityWake(ctx, organizationId);
    }
    await ctx.scheduler.runAfter(
      0,
      internal.node_only.sandbox.session_teardown.teardownThreadSessions,
      { sessionIds },
    );
    return null;
  },
});

/**
 * Reconcile a row to `stopped` when the spawner has released its container
 * (idle/TTL reaper) but the workspace is preserved. Org-scoped; acts on the
 * LIVE row only. Skips a row that is pinned (never reaped) or already
 * `stopped`. Never stamps `destroyedAt` — this is hibernation, not teardown.
 * Used by the management-page reconcile so the UI shows "Stopped" honestly.
 * Returns whether a row flipped.
 */
export const markSessionRowStopped = internalMutation({
  args: { organizationId: v.string(), sessionId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    let stopped = false;
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      if (row.organizationId !== args.organizationId) continue;
      if (!isLiveSessionStatus(row.status)) continue;
      if (row.status === 'stopped' || row.pinned === true) continue;
      await ctx.db.patch(row._id, { status: 'stopped' });
      stopped = true;
    }
    // `stopped` drops the row out of the (creating|active) in-flight count, so it
    // frees a per-org session slot → wake a parked waiter immediately.
    if (stopped) await scheduleSessionCapacityWake(ctx, args.organizationId);
    return stopped;
  },
});

/**
 * Resume in place: normalize the LIVE row to `active`, refresh `lastActivityAt`,
 * and reset the idle/TTL window — but PRESERVE `createdAt` so the per-thread
 * `--resume` lookup still scopes to the same incarnation (files AND
 * conversation continue). A pinned row keeps its far-future `expiresAt`.
 * Org-scoped. Deliberately acts on ANY live status (not just `stopped`): it is
 * idempotent on an already-`active` row (a harmless activity refresh), which
 * lets the turn call it on resume without re-reading the post-reconcile status.
 * Returns whether a row was patched.
 */
export const resumeStoppedSession = internalMutation({
  args: { organizationId: v.string(), sessionId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const now = Date.now();
    let resumed = false;
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      if (row.organizationId !== args.organizationId) continue;
      if (!isLiveSessionStatus(row.status)) continue;
      await ctx.db.patch(row._id, {
        status: 'active',
        lastActivityAt: now,
        ...(row.pinned === true
          ? {}
          : { expiresAt: now + SANDBOX_SESSION_MAX_LIFETIME_MS }),
      });
      resumed = true;
    }
    return resumed;
  },
});

/**
 * Reuse-path resume for a WORKFLOW-SCOPED sandbox row. An `active`/`creating`
 * row already holds a per-org slot — this is just an idempotent refresh. A
 * `stopped` (hibernated) row freed its slot when it stopped, so flipping it
 * back RE-ADMITS through the same FIFO ticket queue as
 * `reserveSessionSlotAndInsert`: claim the ticket the `executeSandboxNode`
 * poll parked (throws WAIT_FIFO when not at the head of an open slot — the
 * caller parks as `awaiting_capacity`), so a paused run resuming under org
 * pressure queues fairly instead of jumping to cap+1. Atomic with the status
 * read — the caller needs no pre-check of the row's current status.
 */
export const resumeAutomationSessionSlot = internalMutation({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    ticket: reserveTicketArg,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      if (row.organizationId !== args.organizationId) continue;
      if (!isLiveSessionStatus(row.status)) continue;
      if (row.status === 'stopped' && row.pinned !== true) {
        const ticketArgs: AdmissionTicketArgs = {
          organizationId: args.organizationId,
          kind: 'session',
          ownerType: row.ownerType,
          ownerId: row.ownerId,
          source: args.ticket.source,
          ...(args.ticket.threadId !== undefined && {
            threadId: args.ticket.threadId,
          }),
          ...(args.ticket.wfExecutionId !== undefined && {
            wfExecutionId: args.ticket.wfExecutionId,
          }),
          ...(args.ticket.stepSlug !== undefined && {
            stepSlug: args.ticket.stepSlug,
          }),
        };
        const ticketCreatedAt = await upsertWaitingTicket(ctx, ticketArgs, now);
        await assertFifoEligible(
          ctx,
          args.organizationId,
          'session',
          ticketCreatedAt,
          sessionBudgetForOwnerType(row.ownerType),
        );
        await claimTicket(ctx, row.ownerType, row.ownerId, now);
      }
      await ctx.db.patch(row._id, {
        status: 'active',
        lastActivityAt: now,
        ...(row.pinned === true
          ? {}
          : { expiresAt: now + SANDBOX_SESSION_MAX_LIFETIME_MS }),
      });
      return true;
    }
    return false;
  },
});

// --- session virtual-key bookkeeping ---------------------------------------

/** Persist a minted session token's sha256 hash + scope (never the plaintext). */
export const insertSessionToken = internalMutation({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    tokenHash: v.string(),
    llmGatewayKeyId: v.optional(v.string()),
    scope: v.object({
      agentKind: v.string(),
      allowedModels: v.array(v.string()),
      integrationGrants: v.array(v.string()),
      budgetCents: v.number(),
      // Workspace-tool dispatch (see sessions_schema.ts scope docs).
      toolGrants: v.optional(v.array(v.string())),
      agentSlug: v.optional(v.string()),
      threadId: v.optional(v.string()),
      userId: v.optional(v.string()),
    }),
    expiresAt: v.number(),
  },
  returns: v.id('sandboxSessionTokens'),
  handler: async (ctx, args) =>
    ctx.db.insert('sandboxSessionTokens', {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      tokenHash: args.tokenHash,
      ...(args.llmGatewayKeyId !== undefined && {
        llmGatewayKeyId: args.llmGatewayKeyId,
      }),
      scope: args.scope,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
    }),
});

/**
 * Revoke every token for a session (on destroy / watchdog reap). Marks each
 * unrevoked row `revokedAt` and returns the `llmGatewayKeyId`s it just revoked so
 * the caller (a `'use node'` teardown action) can also delete the live gateway
 * VK. This mark alone is bookkeeping — the VK stays a spendable credential on
 * the gateway until that API delete runs. Teardown deletes the op rows that the
 * per-turn finalize + recovery watchdog key on, so without this the destroy-
 * during-a-live-turn race would orphan a still-valid VK.
 */
export const revokeTokensForSession = internalMutation({
  args: { sessionId: v.string() },
  returns: v.object({
    revoked: v.number(),
    llmGatewayKeyIds: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let revoked = 0;
    const llmGatewayKeyIds: string[] = [];
    for await (const row of ctx.db
      .query('sandboxSessionTokens')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      if (row.revokedAt === undefined) {
        await ctx.db.patch(row._id, { revokedAt: now });
        revoked += 1;
        if (row.llmGatewayKeyId !== undefined)
          llmGatewayKeyIds.push(row.llmGatewayKeyId);
      }
    }
    return { revoked, llmGatewayKeyIds };
  },
});

/**
 * Mark ONE session token revoked by its gateway key id (per-turn finalize).
 * The external turn revokes its own VK on the gateway the moment the turn
 * settles; marking the matching token row keeps the table honest and stops a
 * later session teardown from re-issuing a redundant gateway DELETE for a key
 * that is already gone. Idempotent — an already-revoked or missing row no-ops.
 */
export const markSessionTokenRevokedByKeyId = internalMutation({
  args: { sessionId: v.string(), llmGatewayKeyId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for await (const row of ctx.db
      .query('sandboxSessionTokens')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      if (
        row.llmGatewayKeyId === args.llmGatewayKeyId &&
        row.revokedAt === undefined
      ) {
        await ctx.db.patch(row._id, { revokedAt: now });
      }
    }
    return null;
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

// --- durable workflow sandbox-step checkpoint ------------------------------

/**
 * Upsert the resume checkpoint for a durable workflow `sandbox`-step agent run
 * (one row per deterministic session). Written on each action-window handoff;
 * the next step segment reads it via `loadAgentCheckpoint` to re-attach to the
 * still-running exec. Each handoff writes the COMPLETE current cursor (a full
 * snapshot — `replace`, not merge), so a field cleared this segment (e.g. a
 * background task that finished) is correctly dropped.
 */
export const insertAgentCheckpoint = internalMutation({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    execId: v.string(),
    lastSeq: v.number(),
    agentSessionId: v.optional(v.string()),
    agentResultSeen: v.optional(v.boolean()),
    agentIdle: v.optional(v.boolean()),
    pendingTaskIds: v.optional(v.array(v.string())),
    apiErrorSeen: v.optional(v.boolean()),
    taskRunId: v.optional(v.id('taskAgentRuns')),
    startedAt: v.number(),
    continuationCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      execId: args.execId,
      lastSeq: args.lastSeq,
      ...(args.agentSessionId !== undefined && {
        agentSessionId: args.agentSessionId,
      }),
      ...(args.agentResultSeen !== undefined && {
        agentResultSeen: args.agentResultSeen,
      }),
      ...(args.agentIdle !== undefined && { agentIdle: args.agentIdle }),
      ...(args.pendingTaskIds !== undefined && {
        pendingTaskIds: args.pendingTaskIds,
      }),
      ...(args.apiErrorSeen !== undefined && {
        apiErrorSeen: args.apiErrorSeen,
      }),
      ...(args.taskRunId !== undefined && { taskRunId: args.taskRunId }),
      startedAt: args.startedAt,
      continuationCount: args.continuationCount,
      updatedAt: Date.now(),
    };
    for await (const existing of ctx.db
      .query('sandboxAgentCheckpoints')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      await ctx.db.replace(existing._id, row);
      return null;
    }
    await ctx.db.insert('sandboxAgentCheckpoints', row);
    return null;
  },
});

/** Delete a session's durable checkpoint (the terminal segment, or the stale
 * `workflow_run` reaper). Idempotent — no row is a no-op. */
export const deleteAgentCheckpoint = internalMutation({
  args: { sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    for await (const row of ctx.db
      .query('sandboxAgentCheckpoints')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});

/** Drop every checkpoint row for a spawner session — the step-scoped row (when
 * scope is `step`) and all `${spawnerSessionId}::${stepSlug}` rows (when scope
 * is `workflow`). Used at workflow-scoped session teardown. Two indexed passes
 * on `by_sessionId`: an exact match plus the `::` prefix range (`:` `;` bounds
 * — `;` is `:` + 1, so the range covers exactly the `::`-prefixed keys). */
export const deleteAgentCheckpointsForSpawnerSession = internalMutation({
  args: { spawnerSessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    for await (const row of ctx.db
      .query('sandboxAgentCheckpoints')
      .withIndex('by_sessionId', (q) =>
        q.eq('sessionId', args.spawnerSessionId),
      )) {
      await ctx.db.delete(row._id);
    }
    for await (const row of ctx.db
      .query('sandboxAgentCheckpoints')
      .withIndex('by_sessionId', (q) =>
        q
          .gte('sessionId', `${args.spawnerSessionId}::`)
          .lt('sessionId', `${args.spawnerSessionId}:;`),
      )) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});

/**
 * Hibernate an automation run's RUN-SCOPED sandbox at a human-gate
 * pause: flip its row to `stopped` so the (creating|active) in-flight count —
 * and with it a per-org automation session slot — is freed for the whole time
 * the run waits on a human, instead of pinning capacity for up to the row
 * TTL. The container itself is left to the spawner's idle sweep (workspace
 * preserved either way); the resume path re-creates against the preserved
 * workspace and flips the row back via `resumeStoppedSession`. Skips pinned
 * rows and (defensively) a session that still has a RUNNING agent-run op.
 * Idempotent; returns whether a row flipped.
 */
export const hibernateAutomationScopedSession = internalMutation({
  args: { executionId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    let stopped = false;
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_owner', (q) =>
        q
          .eq('ownerType', 'workflow_run')
          .eq('ownerId', workflowExecutionOwnerId(args.executionId)),
      )) {
      if (!isLiveSessionStatus(row.status)) continue;
      if (row.status === 'stopped' || row.pinned === true) continue;
      let hasRunningAgentRun = false;
      for await (const op of ctx.db
        .query('sandboxSessionOps')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', row.sessionId))) {
        if (op.kind === 'agent-run' && op.status === 'running') {
          hasRunningAgentRun = true;
          break;
        }
      }
      if (hasRunningAgentRun) continue;
      await ctx.db.patch(row._id, { status: 'stopped' });
      stopped = true;
      if (row.organizationId) {
        await scheduleSessionCapacityWake(ctx, row.organizationId);
      }
    }
    return stopped;
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
    /** Bounded live UI-part transcript for a workflow-run step (run-view feed). */
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
    agentSessionId: v.optional(v.string()),
    exitCode: v.optional(v.number()),
    /** The agent's self-reported terminal status (turn-ended.status), preferred
     * over a bare exit code by the recovery watchdog + fleet page. */
    agentResultStatus: v.optional(v.string()),
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
    lastEventAt: v.optional(v.number()),
    lastSeq: v.optional(v.number()),
    checkpointStorageId: v.optional(v.string()),
    continuationCount: v.optional(v.number()),
    spentCents: v.optional(v.number()),
    pausedReason: v.optional(v.string()),
    /** Lingering transition (claude-code stdin-hold): true stamps agentIdleAt,
     * false clears it. Omitted ⇒ untouched (the usual throttled flush). */
    agentIdle: v.optional(v.boolean()),
    /** Background-task ledger depth (0 clears the field). */
    pendingBackgroundTasks: v.optional(v.number()),
  },
  returns: v.id('sandboxSessionOps'),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existingRow = await ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId_and_execId', (q) =>
        q.eq('sessionId', args.sessionId).eq('execId', args.execId),
      )
      .first();
    const existing: Id<'sandboxSessionOps'> | null = existingRow?._id ?? null;
    const existingLastEventAt: number | undefined = existingRow?.lastEventAt;
    const terminal = args.status !== 'running';
    const patch: Record<string, unknown> = { status: args.status };
    // Optional fields: patch only when provided so a throttled flush that omits
    // them never clobbers a value set at turn start.
    const optional = [
      'progressText',
      'liveTimeline',
      'agentSessionId',
      'exitCode',
      'agentResultStatus',
      'eventLogStorageId',
      'assistantMessageId',
      'mintedKeyId',
      'userId',
      'modelRef',
      'agentSlug',
      'streamId',
      'deadlineMs',
      'heartbeatAt',
      'lastEventAt',
      'lastSeq',
      'checkpointStorageId',
      'continuationCount',
      'spentCents',
      'pausedReason',
    ] as const;
    for (const k of optional) {
      if (args[k] !== undefined) patch[k] = args[k];
    }
    // lastEventAt is sent by two unawaited racers (the 500ms progress flush and
    // the 20s heartbeat tick), so a stale in-flight write can commit after a
    // fresher one. Keep the field monotonic — a regression would re-trip the
    // UI's silence threshold right after events resumed.
    if (
      typeof patch.lastEventAt === 'number' &&
      existingLastEventAt !== undefined &&
      patch.lastEventAt < existingLastEventAt
    ) {
      delete patch.lastEventAt;
    }
    // Lingering flag: an explicit boolean sets/clears the timestamp (patching
    // undefined unsets the field). A terminal status always clears it.
    if (args.agentIdle !== undefined) {
      patch.agentIdleAt = args.agentIdle ? now : undefined;
    }
    if (args.pendingBackgroundTasks !== undefined) {
      patch.pendingBackgroundTasks =
        args.pendingBackgroundTasks > 0
          ? args.pendingBackgroundTasks
          : undefined;
    }
    if (terminal) {
      patch.finishedAt = now;
      patch.agentIdleAt = undefined;
      patch.pendingBackgroundTasks = undefined;
    } else if (existingRow !== null && existingRow.status !== 'running') {
      // A settled op never returns to `running`. The progress writers are
      // unawaited racers (text/timeline flushes, heartbeat ticks), so one can
      // land after the settle stamped the terminal status — without this the
      // run views would spin forever on a finished turn. The payload fields
      // still apply: a late transcript flush is real data worth keeping.
      delete patch.status;
    }

    if (existing) {
      await ctx.db.patch(existing, patch);
      return existing;
    }
    return ctx.db.insert('sandboxSessionOps', {
      // `patch` is built by dynamic key assignment from the `optional` list, so
      // it can't be statically tied to the doc shape; assert to the doc's
      // insert fields (a specific type, not `any`). It carries `status` (always
      // set) + the optional fields; the required identity fields below override
      // the asserted-but-absent ones it claims.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      ...(patch as WithoutSystemFields<Doc<'sandboxSessionOps'>>),
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      execId: args.execId,
      kind: args.kind,
      startedAt: now,
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
    const row = await ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId_and_execId', (q) =>
        q.eq('sessionId', args.sessionId).eq('execId', args.execId),
      )
      .first();
    if (!row) return false; // op row gone → nothing to finalize
    if (row.finalizedAt !== undefined) return false; // already finalized
    await ctx.db.patch(row._id, { finalizedAt: Date.now() });
    return true;
  },
});

/**
 * Atomic single-claimant gate for a watchdog-driven RESUME (re-attach of an
 * abandoned-but-alive exec). Succeeds only if the op is still `running`, not
 * finalized, and its heartbeat is STILL stale (`heartbeatAt < staleBeforeMs`) —
 * re-checked here so a live action that bumped its heartbeat between the
 * abandoned-ops query and this claim is seen and the resume is rejected (the
 * fix for the watchdog double-mirroring a live drainer). On success it bumps
 * `heartbeatAt` (so a concurrent sweep + the resuming continuation's startup
 * window don't re-grab it) and stamps `resumedBy`. Serializable OCC makes the
 * read-then-set race-free, exactly like claimSessionOpFinalize.
 */
export const claimRecoveryResume = internalMutation({
  args: {
    sessionId: v.string(),
    execId: v.string(),
    staleBeforeMs: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId_and_execId', (q) =>
        q.eq('sessionId', args.sessionId).eq('execId', args.execId),
      )
      .first();
    if (!row) return false; // op row gone
    if (row.finalizedAt !== undefined) return false; // already terminal
    if (row.status !== 'running') return false; // not a live turn
    // A live drainer bumped the heartbeat after the query → NOT abandoned.
    if ((row.heartbeatAt ?? 0) >= args.staleBeforeMs) return false;
    await ctx.db.patch(row._id, {
      heartbeatAt: Date.now(),
      resumedBy: 'watchdog',
    });
    return true;
  },
});

/**
 * Stamp the final in-task LLM spend (cents) on a turn's op row at terminal
 * finalize. Separate from `upsertSessionOp` because that forces a `status` and
 * re-stamps `finishedAt`; here we patch ONLY `spentCents`. Called once per turn
 * by the exactly-once finalize winner (after it polls the VK), so the
 * management page's cumulative Spend column reflects single-segment turns that
 * never hit a continuation seam. No-ops silently if the op row was reaped
 * between the finalize claim and the spend poll.
 */
export const recordSessionOpSpend = internalMutation({
  args: {
    sessionId: v.string(),
    execId: v.string(),
    spentCents: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId_and_execId', (q) =>
        q.eq('sessionId', args.sessionId).eq('execId', args.execId),
      )
      .first();
    if (!row) return false; // row gone → no-op
    await ctx.db.patch(row._id, { spentCents: args.spentCents });
    return true;
  },
});

/**
 * Record ONE durable turn-SLO event when an external turn settles (the finalize
 * winner). Outlives the session (op rows are purged on teardown), so the turn
 * dashboard keeps history. Never carries a prompt/reply — only the turn shape.
 */
export const recordTurnEvent = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    userId: v.string(),
    harness: v.string(),
    modelRef: v.optional(v.string()),
    outcome: v.union(
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
      v.literal('timeout'),
    ),
    durationMs: v.number(),
    spentCents: v.optional(v.number()),
    recovered: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('sandboxTurnEvents', {
      organizationId: args.organizationId,
      threadId: args.threadId,
      userId: args.userId,
      harness: args.harness,
      ...(args.modelRef !== undefined ? { modelRef: args.modelRef } : {}),
      outcome: args.outcome,
      durationMs: args.durationMs,
      ...(args.spentCents !== undefined ? { spentCents: args.spentCents } : {}),
      ...(args.recovered !== undefined ? { recovered: args.recovered } : {}),
      createdAt: Date.now(),
    });
    return null;
  },
});

/**
 * @deprecated Kept callable for the deploy window only: in-flight pre-deploy
 * drains still poll this per flush. New drains derive steer-pending from the
 * delivered queue rows and trip the seam at the OBSERVED injection instead
 * (see run_agent's consumption poll + steer-injected handling). Remove
 * together with the schema field's deprecation note.
 */
export const consumeSteerSeamRequest = internalMutation({
  args: { sessionId: v.string(), execId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId_and_execId', (q) =>
        q.eq('sessionId', args.sessionId).eq('execId', args.execId),
      )
      .first();
    if (!row) return false;
    if (row.steerSeamRequestedAt === undefined) return false;
    await ctx.db.patch(row._id, { steerSeamRequestedAt: undefined });
    return true;
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

/** Forensic row for one in-sandbox INTEGRATION dispatch (the /api/integrations
 * bridge). Same trail as recordToolCall for the connector surface:
 * who/what/when/outcome + a sorted param-KEY fingerprint, never values. */
export const recordIntegrationCall = internalMutation({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    slug: v.string(),
    operation: v.string(),
    operationType: v.optional(v.string()),
    userId: v.optional(v.string()),
    outcome: v.string(),
    paramsFingerprint: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('sandboxIntegrationCalls', {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      slug: args.slug,
      operation: args.operation,
      ...(args.operationType !== undefined
        ? { operationType: args.operationType }
        : {}),
      ...(args.userId !== undefined ? { userId: args.userId } : {}),
      outcome: args.outcome,
      ...(args.paramsFingerprint !== undefined
        ? { paramsFingerprint: args.paramsFingerprint }
        : {}),
      calledAt: Date.now(),
    });
    return null;
  },
});

/** Forensic row for one in-sandbox workspace-tool dispatch (the /api/tools
 * bridge). Records who/what/when/outcome and a sorted param-KEY fingerprint —
 * never values — so a call is traceable without logging its contents. */
export const recordToolCall = internalMutation({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    tool: v.string(),
    userId: v.optional(v.string()),
    outcome: v.string(),
    paramsFingerprint: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('sandboxToolCalls', {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      tool: args.tool,
      ...(args.userId !== undefined ? { userId: args.userId } : {}),
      outcome: args.outcome,
      ...(args.paramsFingerprint !== undefined
        ? { paramsFingerprint: args.paramsFingerprint }
        : {}),
      calledAt: Date.now(),
    });
    return null;
  },
});
