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
      // Round-2 / M13: surface privilege-escalation attempts via audit.
      await createAuditLog(ctx, {
        organizationId: args.organizationId,
        actorId: callerId,
        actorEmail: authUser.email ?? '',
        actorType: 'user',
        action: 'gdpr_erasure_denied',
        category: 'admin',
        resourceType: 'user',
        resourceId: args.userId,
        status: 'denied',
        errorMessage: 'caller is not an org admin',
        metadata: { role: member.role },
      });
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

    // Concurrency guard: parallel admin clicks would otherwise insert two
    // rows + schedule two processors racing the same subject. Reject the
    // second click with the existing requestId so the UI can surface the
    // in-flight row instead of retrying (round-2 v05 B6 part 1).
    for (const status of ['pending', 'running'] as const) {
      const active = await ctx.db
        .query('gdprErasureRequests')
        .withIndex('by_org_target_status', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('targetUserId', args.userId)
            .eq('status', status),
        )
        .first();
      if (active) {
        throw new ConvexError({
          code: 'ALREADY_PENDING',
          message: `An erasure request for this subject is already ${status}.`,
          requestId: active._id,
          status,
        });
      }
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

    // Subject's own `documents` rows (uploads). The `documents` table
    // has its own legal-hold target type, so an Art 17 request that
    // would erase a held document must be blocked at request time —
    // not at execution time, since the receipt would otherwise lie
    // about coverage.
    const subjectDocuments = await ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_createdBy', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('createdBy', args.userId),
      )
      .collect();
    const subjectDocumentIds = subjectDocuments.map((d) => String(d._id));

    // Legal-hold gate. GDPR Art 17(3)(e) preserves data subject to legal
    // claims. Refuse the WHOLE request when any of the subject's threads
    // OR documents are held — the receipt cannot lie about coverage, and
    // a partial erasure that omits held neighbors would confuse a future
    // regulator audit. Operator must release the hold first.
    const holds = await loadActiveHolds(ctx, args.organizationId);
    const heldThreadIds: string[] = threadIds.filter((id) =>
      holds.threadIds.has(id),
    );
    const heldDocumentIds: string[] = subjectDocumentIds.filter((id) =>
      holds.documentIds.has(id),
    );
    const userCustodianHeld = holds.userMembershipIds.has(args.userId);
    if (
      holds.orgHeld ||
      heldThreadIds.length > 0 ||
      heldDocumentIds.length > 0 ||
      userCustodianHeld
    ) {
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
          userCustodianHeld,
          heldThreadIds,
          heldDocumentIds,
        },
      });
      throw new ConvexError({
        code: 'LEGAL_HOLD_BLOCKS_ERASURE',
        message: holds.orgHeld
          ? 'Org is under an active legal hold — release the hold before requesting erasure.'
          : userCustodianHeld
            ? 'The subject user is on an active custodian legal hold — release the hold before requesting erasure.'
            : heldThreadIds.length > 0
              ? 'One or more of the subject’s threads are under an active legal hold.'
              : 'One or more of the subject’s documents are under an active legal hold.',
        orgHeld: holds.orgHeld,
        userCustodianHeld,
        heldThreadIds,
        heldDocumentIds,
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
const rowsAndHoldValidator = v.object({
  rows: v.number(),
  skippedByHold: v.number(),
});

const perCategoryValidator = v.object({
  userMemories: rowsAndHoldValidator,
  userPreferences: rowsAndHoldValidator,
  messageFeedback: rowsAndHoldValidator,
  fileMetadata: v.object({
    rows: v.number(),
    blobs: v.number(),
    skippedByHold: v.number(),
  }),
  usageLedger: rowsAndHoldValidator,
  twoFactorAttempts: rowsAndHoldValidator,
  policyAcknowledgements: rowsAndHoldValidator,
  onedrive: rowsAndHoldValidator,
  loginAttempts: v.object({
    attempts: v.number(),
    blockCounters: v.number(),
    skippedByHold: v.number(),
  }),
});

export const finalizeProcessing = internalMutation({
  args: {
    requestId: v.id('gdprErasureRequests'),
    threadsErased: v.number(),
    ragDocumentsRemoved: v.number(),
    documentsErased: v.optional(v.number()),
    documentsSkippedByHold: v.optional(v.number()),
    perCategory: v.optional(perCategoryValidator),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row) return null;
    const targetedCount = row.threadsTargeted?.length ?? 0;
    const documentsSkippedByHold = args.documentsSkippedByHold ?? 0;
    // Aggregate skipped-by-hold across every per-category counter so the
    // receipt status flips to `partial` whenever a mid-flight hold blocked
    // ANY category, not just documents (round-2 v05 B6 / v09 H4).
    const perCategory = args.perCategory;
    const perCategorySkipped = perCategory
      ? perCategory.userMemories.skippedByHold +
        perCategory.userPreferences.skippedByHold +
        perCategory.messageFeedback.skippedByHold +
        perCategory.fileMetadata.skippedByHold +
        perCategory.usageLedger.skippedByHold +
        perCategory.twoFactorAttempts.skippedByHold +
        perCategory.policyAcknowledgements.skippedByHold +
        perCategory.onedrive.skippedByHold +
        perCategory.loginAttempts.skippedByHold
      : 0;
    const totalSkippedByHold = documentsSkippedByHold + perCategorySkipped;
    const status: 'done' | 'partial' | 'failed' = args.errorMessage
      ? 'failed'
      : args.threadsErased < targetedCount || totalSkippedByHold > 0
        ? 'partial'
        : 'done';
    await ctx.db.patch(args.requestId, {
      status,
      threadsErased: args.threadsErased,
      ragDocumentsRemoved: args.ragDocumentsRemoved,
      documentsErased: args.documentsErased,
      documentsSkippedByHold:
        documentsSkippedByHold > 0 ? documentsSkippedByHold : undefined,
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
        documentsErased: args.documentsErased ?? 0,
        documentsSkippedByHold,
        totalSkippedByHold,
        perCategory: perCategory ?? null,
        finalStatus: status,
      },
    });
    return null;
  },
});

/**
 * Erase every `documents` row the subject owns and return the fileIds so
 * the processor can DELETE them on the RAG side. Replaces the prior
 * read-only `listSubjectDocuments`, which collected fileIds but never
 * deleted the row — leaving Art-17 PII (`title`, `content`, `metadata`,
 * `createdBy`) behind on disk and a dangling foreign key to the now-
 * removed RAG vector / `_storage` blob.
 *
 * Uses the `by_organizationId_and_createdBy` compound index so the scan
 * is bounded to the subject's own rows, not the whole org.
 */
export const eraseSubjectDocuments = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  returns: v.object({
    rows: v.number(),
    fileIds: v.array(v.string()),
    skippedByHold: v.number(),
  }),
  handler: async (ctx, args) => {
    // Defense-in-depth: requestErasure already refuses to schedule when
    // a subject document is on hold. A hold placed between scheduling
    // and processor run still has to win — re-read holds inside this
    // mutation and skip the row rather than racing to delete it.
    const holds = await loadActiveHolds(ctx, args.organizationId);
    let rows = 0;
    let skippedByHold = 0;
    const fileIds: string[] = [];
    for await (const doc of ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_createdBy', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('createdBy', args.userId),
      )) {
      if (holds.orgHeld || holds.documentIds.has(String(doc._id))) {
        skippedByHold++;
        continue;
      }
      if (typeof doc.fileId === 'string' && doc.fileId.length > 0) {
        fileIds.push(doc.fileId);
      }
      await ctx.db.delete(doc._id);
      rows++;
    }
    return { rows, fileIds, skippedByHold };
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
/**
 * Per-mutation hold guard for the 10 subject-scope erasers (round-2 v09 H4).
 * `requestErasure` already refuses to schedule when the org is held, but a
 * hold placed AFTER scheduling and BEFORE the per-table mutation runs must
 * still win. Each eraser re-reads holds at the top of its own transaction
 * and skips when the org is held. The helper iterates the same row set
 * twice (once to count what would have been skipped, once when it would
 * have deleted) only on the rare race-window path; the common path takes
 * one extra `loadActiveHolds` read.
 */
async function countOrSkip<T>(
  ctx: import('../_generated/server').MutationCtx,
  organizationId: string,
  iter: () => AsyncIterable<T>,
): Promise<{ orgHeld: boolean; skippedByHold: number }> {
  const holds = await loadActiveHolds(ctx, organizationId);
  if (!holds.orgHeld) return { orgHeld: false, skippedByHold: 0 };
  let skippedByHold = 0;
  for await (const _ of iter()) skippedByHold++;
  return { orgHeld: true, skippedByHold };
}

export const eraseSubjectUserMemories = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.object({ rows: v.number(), skippedByHold: v.number() }),
  handler: async (ctx, args) => {
    const iter = () =>
      ctx.db
        .query('userMemories')
        .withIndex('by_organizationId', (q) =>
          q.eq('organizationId', args.organizationId),
        );
    const guard = await countOrSkip(ctx, args.organizationId, () =>
      (async function* () {
        for await (const row of iter()) {
          if (row.userId === args.userId) yield row;
        }
      })(),
    );
    if (guard.orgHeld) return { rows: 0, skippedByHold: guard.skippedByHold };
    let rows = 0;
    for await (const row of iter()) {
      if (row.userId !== args.userId) continue;
      await ctx.db.delete(row._id);
      rows++;
    }
    return { rows, skippedByHold: 0 };
  },
});

export const eraseSubjectUserPreferences = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.object({ rows: v.number(), skippedByHold: v.number() }),
  handler: async (ctx, args) => {
    const iter = () =>
      ctx.db
        .query('userPreferences')
        .withIndex('by_userId_organizationId', (q) =>
          q.eq('userId', args.userId).eq('organizationId', args.organizationId),
        );
    const guard = await countOrSkip(ctx, args.organizationId, iter);
    if (guard.orgHeld) return { rows: 0, skippedByHold: guard.skippedByHold };
    let rows = 0;
    for await (const row of iter()) {
      await ctx.db.delete(row._id);
      rows++;
    }
    return { rows, skippedByHold: 0 };
  },
});

export const eraseSubjectMessageFeedback = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.object({ rows: v.number(), skippedByHold: v.number() }),
  handler: async (ctx, args) => {
    const iter = () =>
      ctx.db
        .query('messageFeedback')
        .withIndex('by_organizationId', (q) =>
          q.eq('organizationId', args.organizationId),
        );
    const guard = await countOrSkip(ctx, args.organizationId, () =>
      (async function* () {
        for await (const row of iter()) {
          if (row.userId === args.userId) yield row;
        }
      })(),
    );
    if (guard.orgHeld) return { rows: 0, skippedByHold: guard.skippedByHold };
    let rows = 0;
    for await (const row of iter()) {
      if (row.userId !== args.userId) continue;
      await ctx.db.delete(row._id);
      rows++;
    }
    return { rows, skippedByHold: 0 };
  },
});

export const eraseSubjectFileMetadata = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.object({
    rows: v.number(),
    blobs: v.number(),
    skippedByHold: v.number(),
  }),
  handler: async (ctx, args) => {
    const iter = () =>
      ctx.db
        .query('fileMetadata')
        .withIndex('by_org_user', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('uploadedBy', args.userId),
        );
    const guard = await countOrSkip(ctx, args.organizationId, iter);
    if (guard.orgHeld) {
      return { rows: 0, blobs: 0, skippedByHold: guard.skippedByHold };
    }
    let rows = 0;
    let blobs = 0;
    for await (const meta of iter()) {
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
    return { rows, blobs, skippedByHold: 0 };
  },
});

export const eraseSubjectUsageLedger = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.object({ rows: v.number(), skippedByHold: v.number() }),
  handler: async (ctx, args) => {
    const iter = () =>
      ctx.db
        .query('usageLedger')
        .withIndex('by_org_user_period', (q) =>
          q.eq('organizationId', args.organizationId).eq('userId', args.userId),
        );
    const guard = await countOrSkip(ctx, args.organizationId, iter);
    if (guard.orgHeld) return { rows: 0, skippedByHold: guard.skippedByHold };
    let rows = 0;
    for await (const row of iter()) {
      await ctx.db.delete(row._id);
      rows++;
    }
    return { rows, skippedByHold: 0 };
  },
});

export const eraseSubjectTwoFactorAttempts = internalMutation({
  // Table is keyed by userId (no organizationId column), but the GDPR
  // request itself is org-scoped — pass orgId so the hold guard can fire
  // when this org placed a hold mid-flight (round-2 v09 H4).
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.object({ rows: v.number(), skippedByHold: v.number() }),
  handler: async (ctx, args) => {
    const iter = () =>
      ctx.db
        .query('twoFactorAttempts')
        .withIndex('by_userId', (q) => q.eq('userId', args.userId));
    const guard = await countOrSkip(ctx, args.organizationId, iter);
    if (guard.orgHeld) return { rows: 0, skippedByHold: guard.skippedByHold };
    let rows = 0;
    for await (const row of iter()) {
      await ctx.db.delete(row._id);
      rows++;
    }
    return { rows, skippedByHold: 0 };
  },
});

export const eraseSubjectPolicyAcknowledgements = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.object({ rows: v.number(), skippedByHold: v.number() }),
  handler: async (ctx, args) => {
    const iter = () =>
      ctx.db
        .query('policyAcknowledgements')
        .withIndex('by_user_org_policy', (q) =>
          q.eq('userId', args.userId).eq('organizationId', args.organizationId),
        );
    const guard = await countOrSkip(ctx, args.organizationId, iter);
    if (guard.orgHeld) return { rows: 0, skippedByHold: guard.skippedByHold };
    let rows = 0;
    for await (const row of iter()) {
      await ctx.db.delete(row._id);
      rows++;
    }
    return { rows, skippedByHold: 0 };
  },
});

export const eraseSubjectOnedrive = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.object({ rows: v.number(), skippedByHold: v.number() }),
  handler: async (ctx, args) => {
    const iter = () =>
      ctx.db
        .query('onedriveSyncConfigs')
        .withIndex('by_userId', (q) => q.eq('userId', args.userId));
    const guard = await countOrSkip(ctx, args.organizationId, () =>
      (async function* () {
        for await (const row of iter()) {
          if (row.organizationId === args.organizationId) yield row;
        }
      })(),
    );
    if (guard.orgHeld) return { rows: 0, skippedByHold: guard.skippedByHold };
    let rows = 0;
    for await (const row of iter()) {
      if (row.organizationId !== args.organizationId) continue;
      await ctx.db.delete(row._id);
      rows++;
    }
    return { rows, skippedByHold: 0 };
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
  // Tables are email-keyed and global, but the GDPR request is org-scoped.
  // Re-read holds for the requesting org so a mid-flight hold blocks this
  // erasure too (round-2 v09 H4).
  args: { organizationId: v.string(), email: v.string() },
  returns: v.object({
    attempts: v.number(),
    blockCounters: v.number(),
    skippedByHold: v.number(),
  }),
  handler: async (ctx, args) => {
    const lower = args.email.toLowerCase();
    const attemptsIter = () =>
      ctx.db
        .query('loginAttempts')
        .withIndex('by_email', (q) => q.eq('email', lower));
    const blockIter = () =>
      ctx.db
        .query('loginBlockCounters')
        .withIndex('by_email_window', (q) => q.eq('email', lower));
    const holds = await loadActiveHolds(ctx, args.organizationId);
    if (holds.orgHeld) {
      let skippedByHold = 0;
      for await (const _ of attemptsIter()) skippedByHold++;
      for await (const _ of blockIter()) skippedByHold++;
      return { attempts: 0, blockCounters: 0, skippedByHold };
    }
    let attempts = 0;
    for await (const row of attemptsIter()) {
      await ctx.db.delete(row._id);
      attempts++;
    }
    let blockCounters = 0;
    for await (const row of blockIter()) {
      await ctx.db.delete(row._id);
      blockCounters++;
    }
    return { attempts, blockCounters, skippedByHold: 0 };
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
    let documentsErased = 0;
    let documentsSkippedByHold = 0;
    // Per-category counters captured from each `eraseSubject*` mutation so
    // the receipt + audit log accurately reflect what was erased and what
    // was skipped by a mid-flight legal hold (round-2 v05 B6 part 2).
    const perCategory: PerCategoryCounts = {
      userMemories: { rows: 0, skippedByHold: 0 },
      userPreferences: { rows: 0, skippedByHold: 0 },
      messageFeedback: { rows: 0, skippedByHold: 0 },
      fileMetadata: { rows: 0, blobs: 0, skippedByHold: 0 },
      usageLedger: { rows: 0, skippedByHold: 0 },
      twoFactorAttempts: { rows: 0, skippedByHold: 0 },
      policyAcknowledgements: { rows: 0, skippedByHold: 0 },
      onedrive: { rows: 0, skippedByHold: 0 },
      loginAttempts: {
        attempts: 0,
        blockCounters: 0,
        skippedByHold: 0,
      },
    };
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
        if (cascadeDone) {
          threadsErased += 1;
        } else {
          // Hit the page-attempts ceiling without finishing the
          // cascade. Surface a `failure` audit row so the operator
          // dashboard sees the stuck thread instead of a silent
          // partial result (round-2 / M12).
          await ctx.runMutation(
            internal.audit_logs.internal_mutations.createAuditLog,
            {
              organizationId: state.organizationId,
              actorId: 'system',
              actorType: 'system',
              action: 'gdpr_erasure.cascade_attempts_exhausted',
              category: 'admin',
              resourceType: 'thread',
              resourceId: threadId,
              status: 'failure',
              errorMessage: `cascade did not complete in ${MAX_CASCADE_ATTEMPTS_PER_THREAD} attempts`,
              metadata: { requestId: args.requestId, threadId },
            },
          );
        }
      }

      // Erase the subject's `documents` rows AND collect the fileIds in
      // one mutation, then propagate to the RAG service. The mutation is
      // ordered before RAG so a partial RAG failure cannot resurrect the
      // DB row on retry. RAG-side: best-effort — a 404 means the row was
      // already deleted; any other non-2xx is logged but doesn't fail the
      // whole request, since the DB-side cascade already succeeded and
      // partial RAG cleanup is itself a `partial` state.
      const docResult = await ctx.runMutation(
        internal.governance.erasure.eraseSubjectDocuments,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      documentsErased = docResult.rows;
      documentsSkippedByHold = docResult.skippedByHold;
      for (const fileId of docResult.fileIds) {
        try {
          const res = await ragFetch(
            `/api/v1/documents/${encodeURIComponent(fileId)}`,
            { method: 'DELETE', timeoutMs: 10_000 },
          );
          if (res.ok || res.status === 404) {
            ragDocumentsRemoved += 1;
          } else {
            console.warn(
              `[gdprErasure] RAG DELETE returned ${res.status} for fileId=${fileId}`,
            );
          }
        } catch (error) {
          console.warn(
            `[gdprErasure] RAG DELETE failed for fileId=${fileId}:`,
            error,
          );
        }
      }

      // Per-table subject scope. Each helper is idempotent (delete-if-
      // exists on indexed lookups), so a re-tried processor run after a
      // partial earlier run is safe. Counts surface in the audit log of
      // finalizeProcessing for the receipt.
      perCategory.userMemories = await ctx.runMutation(
        internal.governance.erasure.eraseSubjectUserMemories,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      perCategory.userPreferences = await ctx.runMutation(
        internal.governance.erasure.eraseSubjectUserPreferences,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      perCategory.messageFeedback = await ctx.runMutation(
        internal.governance.erasure.eraseSubjectMessageFeedback,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      perCategory.fileMetadata = await ctx.runMutation(
        internal.governance.erasure.eraseSubjectFileMetadata,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      perCategory.usageLedger = await ctx.runMutation(
        internal.governance.erasure.eraseSubjectUsageLedger,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      perCategory.twoFactorAttempts = await ctx.runMutation(
        internal.governance.erasure.eraseSubjectTwoFactorAttempts,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      perCategory.policyAcknowledgements = await ctx.runMutation(
        internal.governance.erasure.eraseSubjectPolicyAcknowledgements,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      perCategory.onedrive = await ctx.runMutation(
        internal.governance.erasure.eraseSubjectOnedrive,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );

      // loginAttempts / loginBlockCounters are email-keyed (not
      // userId-keyed). Look up the email via BetterAuth before the
      // user row itself is touched.
      const subjectEmail = await ctx.runMutation(
        internal.governance.erasure.lookupSubjectEmail,
        { userId: state.targetUserId },
      );
      if (subjectEmail) {
        perCategory.loginAttempts = await ctx.runMutation(
          internal.governance.erasure.eraseSubjectLoginAttempts,
          {
            organizationId: state.organizationId,
            email: subjectEmail,
          },
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
      documentsErased,
      documentsSkippedByHold,
      perCategory,
      errorMessage,
    });
    return null;
  },
});

interface RowsAndHold {
  rows: number;
  skippedByHold: number;
}

interface FileMetadataCounts extends RowsAndHold {
  blobs: number;
}

interface LoginAttemptsCounts {
  attempts: number;
  blockCounters: number;
  skippedByHold: number;
}

interface PerCategoryCounts {
  userMemories: RowsAndHold;
  userPreferences: RowsAndHold;
  messageFeedback: RowsAndHold;
  fileMetadata: FileMetadataCounts;
  usageLedger: RowsAndHold;
  twoFactorAttempts: RowsAndHold;
  policyAcknowledgements: RowsAndHold;
  onedrive: RowsAndHold;
  loginAttempts: LoginAttemptsCounts;
}
