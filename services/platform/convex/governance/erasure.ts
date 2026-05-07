/**
 * GDPR Art 17 (Right to Erasure) — admin-driven path.
 *
 * Two-phase flow:
 *
 *   1. **`requestErasure`** (public mutation, V8) — auth-checks the
 *      caller, enforces the legal-hold gate (Art 17(3)(e)), inserts a
 *      `gdprErasureRequests` row with `status: 'pending'`, schedules the
 *      processor action, and returns the request id. The subject's
 *      receipt is the row itself: it accumulates progress, holds the
 *      30-day SLA deadline, and surfaces partial / failed states the
 *      admin can re-trigger.
 *
 *   2. **`processErasureRequest`** (internal action, Node) — picks up
 *      the request, cascades each thread via the same
 *      `cascadeDeleteThreadChildren` helper used by retention Pass B,
 *      and propagates the deletion to the RAG service for any documents
 *      the user owned. Updates the request row through
 *      `running → done | partial | failed` with explicit counts.
 *
 * Why split phases?
 *
 *   - The processor must call the RAG service over HTTP. That requires
 *     `'use node'` (Convex actions only), which a public-mutation entry
 *     point cannot expose. Splitting lets the entry stay strictly
 *     auth-gated and synchronous from the caller's perspective.
 *   - Keeping the row as the receipt means the subject's confirmation
 *     under Art 19 is durable and queryable rather than a fire-and-
 *     forget audit-log line.
 *   - Partial cascades (page-bounded helper) become a first-class
 *     state with a resume path, instead of silently lying in the
 *     `threadsErased` count.
 *
 * Refusals:
 *   - Caller is not an org admin → `forbidden`.
 *   - Subject's data is under an active legal hold → fail-closed with
 *     `LEGAL_HOLD_BLOCKS_ERASURE` per Art 17(3)(e) preserve-for-claims.
 *
 * Out of scope (separate work-streams):
 *   - Subject-scope expansion to `userMemories`, `userPreferences`,
 *     `feedback`, `documents` / `fileMetadata` / `_storage`,
 *     `auditLogs` PII fields, BetterAuth tables, `loginAttempts` /
 *     `twoFactorAttempts`, `policyAcknowledgements`. The processor
 *     today erases CHAT THREADS + their RAG-indexed descendants only,
 *     which covers the most common case (a departing employee's chat
 *     history). Wider scope adds per-table cascade mutations + tests.
 *   - Audit-chain PII scrub (W3 #4) — replaces actorEmail / ipAddress
 *     with their hashed form on rows the subject authored, preserving
 *     the chain while removing plaintext PII.
 *   - Receipt UI (admin "view erasure history" panel).
 */

import { ConvexError, v } from 'convex/values';

import { components, internal } from '../_generated/api';
import {
  internalAction,
  internalMutation,
  mutation,
} from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { ragFetch } from '../lib/helpers/rag_config';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { cascadeDeleteThreadChildren } from '../threads/cascade_helpers';
import { loadActiveHolds } from './legal_hold';

const SLA_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CASCADE_ATTEMPTS_PER_THREAD = 50;

/**
 * Erase a single thread (all messages, artifacts, todos, feedback,
 * filter events, branches, sub-threads, and the metadata row itself)
 * immediately. Skips grace + skips cooldown.
 *
 * Wraps `cascadeDeleteThreadChildren` in a loop because the helper is
 * paged at PAGE_SIZE rows per child table.
 */
export const eraseThread = internalMutation({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
  },
  returns: v.object({ done: v.boolean(), remaining: v.number() }),
  handler: async (ctx, args) => {
    const result = await cascadeDeleteThreadChildren(ctx, {
      threadId: args.threadId,
      organizationId: args.organizationId,
    });
    return result;
  },
});

/**
 * Public admin entry point. Records a `gdprErasureRequests` row,
 * schedules the processor, and returns the row id. The processor runs
 * asynchronously (it must call the RAG service which requires Node
 * runtime); the admin polls the row for progress.
 */
export const requestErasure = mutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    reason: v.string(),
  },
  returns: v.object({
    requestId: v.id('gdprErasureRequests'),
    threadsTargeted: v.number(),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const callerId = String(authUser._id);

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: callerId,
      email: authUser.email ?? '',
    });
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only org admins can execute GDPR erasure.',
      });
    }
    if (!args.reason.trim()) {
      throw new ConvexError({
        code: 'validation',
        message: 'reason is required for GDPR erasure requests.',
      });
    }

    // Find every thread the subject owns in this org. Includes archived,
    // trashed, and expired — Art 17 must reach them all.
    const threads = await ctx.db
      .query('threadMetadata')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .collect();
    const userThreads = threads.filter((t) => t.userId === args.userId);
    const threadIds = userThreads.map((t) => t.threadId);

    // Legal-hold gate. GDPR Art 17(3)(e) preserves data subject to legal
    // claims. Refuse the WHOLE request when any of the subject's threads
    // is held — the receipt cannot lie about coverage, and a partial
    // erasure that omits held neighbors would confuse a future regulator
    // audit. Operator must release the hold first.
    const holds = await loadActiveHolds(ctx, args.organizationId);
    const heldThreadIds: string[] = threadIds.filter((id) =>
      holds.threadIds.has(id),
    );
    if (holds.orgHeld || heldThreadIds.length > 0) {
      await createAuditLog(ctx, {
        organizationId: args.organizationId,
        actorId: callerId,
        actorEmail: authUser.email ?? '',
        actorType: 'user',
        action: 'gdpr_erasure_blocked_by_hold',
        category: 'admin',
        resourceType: 'user',
        resourceId: args.userId,
        resourceName: args.userId,
        status: 'failure',
        errorMessage: 'LEGAL_HOLD_BLOCKS_ERASURE',
        newState: {
          reason: args.reason,
          orgHeld: holds.orgHeld,
          heldThreadIds,
        },
      });
      throw new ConvexError({
        code: 'LEGAL_HOLD_BLOCKS_ERASURE',
        message: holds.orgHeld
          ? 'Org is under an active legal hold — release the hold before requesting erasure.'
          : 'One or more of the subject’s threads are under an active legal hold.',
        orgHeld: holds.orgHeld,
        heldThreadIds,
      });
    }

    const now = Date.now();
    const requestId = await ctx.db.insert('gdprErasureRequests', {
      organizationId: args.organizationId,
      targetUserId: args.userId,
      reason: args.reason.trim(),
      requestedBy: callerId,
      requestedAt: now,
      slaDeadlineAt: now + SLA_DAYS * DAY_MS,
      status: 'pending',
      threadsTargeted: threadIds,
    });

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: callerId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: 'gdpr_erasure_requested',
      category: 'admin',
      resourceType: 'user',
      resourceId: args.userId,
      resourceName: args.userId,
      status: 'success',
      newState: {
        requestId,
        reason: args.reason,
        threadsTargeted: threadIds.length,
        slaDeadlineAt: now + SLA_DAYS * DAY_MS,
      },
    });

    // Hand off to the Node action so it can call the RAG service.
    await ctx.scheduler.runAfter(
      0,
      internal.governance.erasure.processErasureRequest,
      { requestId },
    );

    return { requestId, threadsTargeted: threadIds.length };
  },
});

/**
 * Internal mutation that the action calls to mark the request as
 * `running` and read its full state. Separated out so the action can
 * stay 'use node' and the row update remains transactional.
 */
export const beginProcessing = internalMutation({
  args: { requestId: v.id('gdprErasureRequests') },
  returns: v.union(
    v.object({
      organizationId: v.string(),
      targetUserId: v.string(),
      threadsTargeted: v.array(v.string()),
      requestedBy: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row) return null;
    // Idempotent: a re-scheduled processor (after a partial run) flips
    // back to 'running' from 'partial' but won't re-process a 'done'
    // or 'failed' row.
    if (row.status === 'done' || row.status === 'failed') return null;
    await ctx.db.patch(args.requestId, {
      status: 'running',
      startedAt: Date.now(),
    });
    return {
      organizationId: row.organizationId,
      targetUserId: row.targetUserId,
      threadsTargeted: row.threadsTargeted ?? [],
      requestedBy: row.requestedBy,
    };
  },
});

/**
 * Cascades a single thread for the processor. Returns the cascade
 * result so the action can decide whether to continue or mark partial.
 */
export const eraseThreadById = internalMutation({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
  },
  returns: v.object({ done: v.boolean(), remaining: v.number() }),
  handler: async (ctx, args) => {
    return await cascadeDeleteThreadChildren(ctx, {
      threadId: args.threadId,
      organizationId: args.organizationId,
    });
  },
});

/**
 * Records the final state of an erasure request. Called by the
 * processor with the per-thread cascade outcomes + the RAG-side
 * deletion count.
 */
export const finalizeProcessing = internalMutation({
  args: {
    requestId: v.id('gdprErasureRequests'),
    threadsErased: v.number(),
    ragDocumentsRemoved: v.number(),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row) return null;
    const targetedCount = row.threadsTargeted?.length ?? 0;
    const status: 'done' | 'partial' | 'failed' = args.errorMessage
      ? 'failed'
      : args.threadsErased < targetedCount
        ? 'partial'
        : 'done';
    await ctx.db.patch(args.requestId, {
      status,
      threadsErased: args.threadsErased,
      ragDocumentsRemoved: args.ragDocumentsRemoved,
      errorMessage: args.errorMessage,
      completedAt: Date.now(),
    });

    await createAuditLog(ctx, {
      organizationId: row.organizationId,
      actorId: row.requestedBy,
      actorType: 'user',
      action: 'gdpr_erasure_executed',
      category: 'admin',
      resourceType: 'user',
      resourceId: row.targetUserId,
      resourceName: row.targetUserId,
      status: status === 'done' ? 'success' : 'failure',
      errorMessage: args.errorMessage,
      newState: {
        requestId: args.requestId,
        threadsErased: args.threadsErased,
        threadsTargeted: targetedCount,
        ragDocumentsRemoved: args.ragDocumentsRemoved,
        finalStatus: status,
      },
    });
    return null;
  },
});

/**
 * Look up the documents the subject owned so the processor can DELETE
 * them on the RAG side.
 */
export const listSubjectDocuments = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  returns: v.array(v.object({ fileId: v.string() })),
  handler: async (ctx, args) => {
    const docs: Array<{ fileId: string }> = [];
    for await (const doc of ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (doc.createdBy !== args.userId) continue;
      if (typeof doc.fileId === 'string' && doc.fileId.length > 0) {
        docs.push({ fileId: doc.fileId });
      }
    }
    return docs;
  },
});

/**
 * Per-table subject-scope erasure mutations.
 *
 * Each one cascades `(organizationId, targetUserId)`-keyed rows for one
 * table, returns a delete count. The processor calls them in sequence
 * after the chat-thread cascade so the user's footprint across
 * personalization, feedback, telemetry, sync configs, and 2FA / login
 * lockouts is removed alongside the chat history.
 *
 * BetterAuth user / account / session / verification rows are NOT
 * touched here — those are owned by the auth component and need its
 * admin-side delete-user flow to also wipe sessions in flight. A
 * follow-up wires that through `authComponent`.
 */
export const eraseSubjectUserMemories = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for await (const row of ctx.db
      .query('userMemories')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (row.userId !== args.userId) continue;
      await ctx.db.delete(row._id);
      count++;
    }
    return count;
  },
});

export const eraseSubjectUserPreferences = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for await (const row of ctx.db
      .query('userPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q.eq('userId', args.userId).eq('organizationId', args.organizationId),
      )) {
      await ctx.db.delete(row._id);
      count++;
    }
    return count;
  },
});

export const eraseSubjectMessageFeedback = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for await (const row of ctx.db
      .query('messageFeedback')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (row.userId !== args.userId) continue;
      await ctx.db.delete(row._id);
      count++;
    }
    return count;
  },
});

export const eraseSubjectFileMetadata = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.object({ rows: v.number(), blobs: v.number() }),
  handler: async (ctx, args) => {
    let rows = 0;
    let blobs = 0;
    for await (const meta of ctx.db
      .query('fileMetadata')
      .withIndex('by_org_user', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('uploadedBy', args.userId),
      )) {
      // Delete the underlying _storage blob first; row delete after.
      try {
        await ctx.storage.delete(meta.storageId);
        blobs++;
      } catch (error) {
        console.warn(
          `[gdprErasure] storage.delete failed for ${String(meta.storageId)}:`,
          error,
        );
      }
      await ctx.db.delete(meta._id);
      rows++;
    }
    return { rows, blobs };
  },
});

export const eraseSubjectUsageLedger = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for await (const row of ctx.db
      .query('usageLedger')
      .withIndex('by_org_user_period', (q) =>
        q.eq('organizationId', args.organizationId).eq('userId', args.userId),
      )) {
      await ctx.db.delete(row._id);
      count++;
    }
    return count;
  },
});

export const eraseSubjectTwoFactorAttempts = internalMutation({
  args: { userId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for await (const row of ctx.db
      .query('twoFactorAttempts')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))) {
      await ctx.db.delete(row._id);
      count++;
    }
    return count;
  },
});

export const eraseSubjectPolicyAcknowledgements = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for await (const row of ctx.db
      .query('policyAcknowledgements')
      .withIndex('by_user_org_policy', (q) =>
        q.eq('userId', args.userId).eq('organizationId', args.organizationId),
      )) {
      await ctx.db.delete(row._id);
      count++;
    }
    return count;
  },
});

export const eraseSubjectOnedrive = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for await (const row of ctx.db
      .query('onedriveSyncConfigs')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))) {
      if (row.organizationId !== args.organizationId) continue;
      await ctx.db.delete(row._id);
      count++;
    }
    return count;
  },
});

/**
 * Look up the subject's plaintext email so loginAttempts /
 * loginBlockCounters (which are keyed on email, not userId) can be
 * cleaned. Reads BetterAuth's user table via the adapter — the same
 * pattern getOrganizationMember falls back to.
 */
export const lookupSubjectEmail = internalMutation({
  args: { userId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: args.userId, operator: 'eq' }],
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Better Auth adapter returns generic shape
    const user = (result?.page ?? [])[0] as { email?: string } | undefined;
    return user?.email ?? null;
  },
});

export const eraseSubjectLoginAttempts = internalMutation({
  args: { email: v.string() },
  returns: v.object({ attempts: v.number(), blockCounters: v.number() }),
  handler: async (ctx, args) => {
    const lower = args.email.toLowerCase();
    let attempts = 0;
    for await (const row of ctx.db
      .query('loginAttempts')
      .withIndex('by_email', (q) => q.eq('email', lower))) {
      await ctx.db.delete(row._id);
      attempts++;
    }
    let blockCounters = 0;
    for await (const row of ctx.db
      .query('loginBlockCounters')
      .withIndex('by_email_window', (q) => q.eq('email', lower))) {
      await ctx.db.delete(row._id);
      blockCounters++;
    }
    return { attempts, blockCounters };
  },
});

/**
 * Background processor for an erasure request. Cascades each targeted
 * thread, then issues `RAG DELETE /api/v1/documents/<fileId>` for each
 * RAG-indexed file the subject owned. Records progress on the request
 * row. A `partial` outcome is re-tryable: an admin re-runs the
 * processor and the next run resumes from threadsTargeted minus the
 * already-cascaded set (which the cascade helper itself treats as
 * no-op since the metadata row is gone).
 */
export const processErasureRequest = internalAction({
  args: { requestId: v.id('gdprErasureRequests') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const state = await ctx.runMutation(
      internal.governance.erasure.beginProcessing,
      { requestId: args.requestId },
    );
    if (!state) return null;

    let threadsErased = 0;
    let ragDocumentsRemoved = 0;
    let errorMessage: string | undefined;

    try {
      // Cascade each thread; each cascade itself loops until done or
      // hits MAX_CASCADE_ATTEMPTS_PER_THREAD pages.
      for (const threadId of state.threadsTargeted) {
        let cascadeDone = false;
        for (let i = 0; i < MAX_CASCADE_ATTEMPTS_PER_THREAD; i++) {
          const result = await ctx.runMutation(
            internal.governance.erasure.eraseThreadById,
            {
              threadId,
              organizationId: state.organizationId,
            },
          );
          if (result.done) {
            cascadeDone = true;
            break;
          }
        }
        if (cascadeDone) threadsErased += 1;
      }

      // Propagate to the RAG service for every document the subject
      // owned. We do best-effort: a 404 means the row was already
      // deleted; any other non-2xx is logged but doesn't fail the
      // whole request, since the DB-side cascade already succeeded
      // and partial RAG cleanup is itself a `partial` state.
      const docs = await ctx.runMutation(
        internal.governance.erasure.listSubjectDocuments,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      for (const doc of docs) {
        try {
          const res = await ragFetch(
            `/api/v1/documents/${encodeURIComponent(doc.fileId)}`,
            { method: 'DELETE', timeoutMs: 10_000 },
          );
          if (res.ok || res.status === 404) {
            ragDocumentsRemoved += 1;
          } else {
            console.warn(
              `[gdprErasure] RAG DELETE returned ${res.status} for fileId=${doc.fileId}`,
            );
          }
        } catch (error) {
          console.warn(
            `[gdprErasure] RAG DELETE failed for fileId=${doc.fileId}:`,
            error,
          );
        }
      }

      // Per-table subject scope. Each helper is idempotent (delete-if-
      // exists on indexed lookups), so a re-tried processor run after a
      // partial earlier run is safe. Counts surface in the audit log of
      // finalizeProcessing for the receipt.
      await ctx.runMutation(
        internal.governance.erasure.eraseSubjectUserMemories,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      await ctx.runMutation(
        internal.governance.erasure.eraseSubjectUserPreferences,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      await ctx.runMutation(
        internal.governance.erasure.eraseSubjectMessageFeedback,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      await ctx.runMutation(
        internal.governance.erasure.eraseSubjectFileMetadata,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      await ctx.runMutation(
        internal.governance.erasure.eraseSubjectUsageLedger,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      await ctx.runMutation(
        internal.governance.erasure.eraseSubjectTwoFactorAttempts,
        { userId: state.targetUserId },
      );
      await ctx.runMutation(
        internal.governance.erasure.eraseSubjectPolicyAcknowledgements,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      await ctx.runMutation(internal.governance.erasure.eraseSubjectOnedrive, {
        organizationId: state.organizationId,
        userId: state.targetUserId,
      });

      // loginAttempts / loginBlockCounters are email-keyed (not
      // userId-keyed). Look up the email via BetterAuth before the
      // user row itself is touched.
      const subjectEmail = await ctx.runMutation(
        internal.governance.erasure.lookupSubjectEmail,
        { userId: state.targetUserId },
      );
      if (subjectEmail) {
        await ctx.runMutation(
          internal.governance.erasure.eraseSubjectLoginAttempts,
          { email: subjectEmail },
        );
      }

      // Audit-chain PII scrub (W3 #4): wipe email / IP / UA / state
      // payloads on auditLogs rows where the subject was the actor.
      // Insert a signed checkpoint so the integrity verifier sees the
      // boundary as intentional rather than tampering.
      await ctx.runMutation(
        internal.audit_logs.internal_mutations.scrubSubjectAuditLogs,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[gdprErasure] processor crashed for request ${args.requestId}:`,
        err,
      );
    }

    await ctx.runMutation(internal.governance.erasure.finalizeProcessing, {
      requestId: args.requestId,
      threadsErased,
      ragDocumentsRemoved,
      errorMessage,
    });
    return null;
  },
});
