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
import { hashEmailForAudit } from '../lib/helpers/pii_hash';
import { ragFetch } from '../lib/helpers/rag_config';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { cascadeDeleteThreadChildren } from '../threads/cascade_helpers';
import { eraseDocumentBlobs } from './erase_document_blobs';
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
    //
    // `'blocked'` is also reject-on-collide: a hold-blocked row is
    // terminal and the operator must release the hold + call
    // `retryErasureRequest` to re-schedule. Re-using a blocked row
    // (instead of stacking new ones) keeps the receipt history clean
    // for regulator audits.
    for (const status of ['pending', 'running', 'blocked'] as const) {
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
    // trashed, and expired — Art 17 must reach them all. Uses the
    // `by_org_user` compound index (Phase A.3.4) so the per-transaction
    // read is bounded by the subject's own thread count rather than the
    // whole org's. Pre-fix, `.collect()` over `by_organizationId` then
    // JS-filtering by userId silently truncated past Convex's 16K
    // per-transaction read limit on large orgs — threads beyond the
    // cap escaped enumeration and were never erased (spoliation).
    // Round-2 review CRITICAL #13. The 16K cap is now bounded by a
    // single user's thread count; in practice threads-per-user is
    // hundreds at most, so the natural ceiling is far below the limit.
    // If a future user scenario approaches it, switch to a paged
    // scheduler-driven enumeration in the processor.
    const threadIds: string[] = [];
    for await (const t of ctx.db
      .query('threadMetadata')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', args.organizationId).eq('userId', args.userId),
      )) {
      threadIds.push(t.threadId);
    }

    // Round-2 V5 P0-15: insert the receipt row BEFORE the hold gate so
    // a regulator audit has structured proof that the request was
    // received. Previously, hold-blocked requests threw without writing
    // the row, leaving only an audit-log entry — `gdprErasureRequests`
    // showed zero rows for the subject and `threadsBlockedByHold` /
    // `documentsBlockedByHold` schema fields stayed dead.
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

    // Legal-hold gate. GDPR Art 17(3)(e) preserves data subject to legal
    // claims. After the User+Org pivot, hold scope is fully expressed as
    // org-wide or user-custodian (per-row hold target types were dropped),
    // both of which cover every artifact owned by the subject — so refuse
    // when either is active. Persists the held arrays on the row before
    // throwing so the UI surfaces "blocked at: <list>" without a separate
    // audit-log query.
    const holds = await loadActiveHolds(ctx, args.organizationId);
    const userCustodianHeld = holds.userMembershipIds.has(args.userId);
    if (holds.orgHeld || userCustodianHeld) {
      // Subject's own `documents` rows (uploads) — collected for the
      // blocked-receipt's `documentsBlockedByHold` so the row tells the
      // regulator exactly which artifacts were preserved.
      const subjectDocumentIds: string[] = [];
      for await (const d of ctx.db
        .query('documents')
        .withIndex('by_organizationId_and_createdBy', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('createdBy', args.userId),
        )) {
        subjectDocumentIds.push(String(d._id));
      }

      await ctx.db.patch(requestId, {
        status: 'blocked',
        threadsBlockedByHold: threadIds,
        documentsBlockedByHold: subjectDocumentIds,
        errorMessage: holds.orgHeld ? 'org_hold' : 'user_custodian_hold',
        completedAt: now,
      });
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
          requestId,
          reason: args.reason,
          orgHeld: holds.orgHeld,
          userCustodianHeld,
          threadsBlockedByHold: threadIds.length,
          documentsBlockedByHold: subjectDocumentIds.length,
        },
      });
      throw new ConvexError({
        code: 'LEGAL_HOLD_BLOCKS_ERASURE',
        message: holds.orgHeld
          ? 'Org is under an active legal hold — release the hold and use Retry to re-schedule erasure.'
          : 'The subject user is on an active custodian legal hold — release the hold and use Retry to re-schedule erasure.',
        orgHeld: holds.orgHeld,
        userCustodianHeld,
        requestId,
      });
    }

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
    // Watchdog/finalize race: if `recoverStuckErasureRequests` has
    // already flipped this row to `failed` because the action was
    // taking too long, do NOT overwrite the watchdog's verdict with a
    // late "done" status. Emit a separate audit row recording the late
    // finalize so operators can see the action eventually completed
    // even though the watchdog had given up on it. Round-2 review
    // CRITICAL #22.
    if (
      row.status === 'failed' &&
      row.errorMessage === 'Erasure timed out (watchdog)'
    ) {
      await createAuditLog(ctx, {
        organizationId: row.organizationId,
        actorId: row.requestedBy,
        actorType: 'system',
        action: 'gdpr_erasure_late_finalize_dropped',
        category: 'admin',
        resourceType: 'user',
        resourceId: row.targetUserId,
        resourceName: row.targetUserId,
        status: 'failure',
        errorMessage:
          'finalize arrived after watchdog marked the run failed; status preserved',
        newState: {
          requestId: args.requestId,
          intendedThreadsErased: args.threadsErased,
          intendedDocumentsErased: args.documentsErased ?? 0,
        },
      });
      return null;
    }
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
    const userCustodianHeld = holds.userMembershipIds.has(args.userId);
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
      // Per-document hold target type was deprecated by the User+Org
      // pivot; refusal at request time gates org-wide and user-custodian
      // holds upstream. The remaining `orgHeld || userCustodianHeld`
      // re-check defends against a hold placed mid-flight between
      // scheduling and processor run (round-2 v09 H4 + CRITICAL #14).
      // Subject-cascade is implicit: this iteration only touches docs
      // `createdBy: args.userId`.
      if (holds.orgHeld || userCustodianHeld) {
        skippedByHold++;
        continue;
      }

      // Round-2 V5 P0-12: previously this loop only collected `doc.fileId`
      // for the RAG fan-out and never deleted the `_storage` blob OR the
      // `doc.historyFiles[]` blobs OR the corresponding fileMetadata
      // rows. Lift the retention-path pattern into the shared helper so
      // both routes physically erase the same set of bytes. Returns
      // every storageId touched (primary + history) so the processor's
      // RAG fan-out covers history blobs too.
      const erased = await eraseDocumentBlobs(ctx, doc);
      for (const storageId of erased.storageIdsDeleted) {
        fileIds.push(storageId);
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
 * `requestErasure` already refuses to schedule when the org is held OR
 * the subject is on a custodian hold, but a hold placed AFTER scheduling
 * and BEFORE the per-table mutation runs must still win. Each eraser
 * re-reads holds at the top of its own transaction and skips when:
 *
 *   - the org as a whole is held, OR
 *   - the subject userId appears in `holds.userMembershipIds` (i.e. a
 *     custodian hold has been placed on this specific user since
 *     scheduling).
 *
 * Pre-fix, only `orgHeld` was checked, leaving a window where a
 * custodian-hold race could let GDPR erasure delete data the hold was
 * meant to preserve — FRCP 37(e) spoliation. Round-2 review CRITICAL #14.
 */
async function countOrSkip<T>(
  ctx: import('../_generated/server').MutationCtx,
  organizationId: string,
  userId: string,
  iter: () => AsyncIterable<T>,
): Promise<{ heldByOrgOrUser: boolean; skippedByHold: number }> {
  const holds = await loadActiveHolds(ctx, organizationId);
  const userHeld = holds.userMembershipIds.has(userId);
  if (!holds.orgHeld && !userHeld) {
    return { heldByOrgOrUser: false, skippedByHold: 0 };
  }
  let skippedByHold = 0;
  for await (const _ of iter()) skippedByHold++;
  return { heldByOrgOrUser: true, skippedByHold };
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
    const guard = await countOrSkip(ctx, args.organizationId, args.userId, () =>
      (async function* () {
        for await (const row of iter()) {
          if (row.userId === args.userId) yield row;
        }
      })(),
    );
    if (guard.heldByOrgOrUser)
      return { rows: 0, skippedByHold: guard.skippedByHold };
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
    const guard = await countOrSkip(
      ctx,
      args.organizationId,
      args.userId,
      iter,
    );
    if (guard.heldByOrgOrUser)
      return { rows: 0, skippedByHold: guard.skippedByHold };
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
    const guard = await countOrSkip(ctx, args.organizationId, args.userId, () =>
      (async function* () {
        for await (const row of iter()) {
          if (row.userId === args.userId) yield row;
        }
      })(),
    );
    if (guard.heldByOrgOrUser)
      return { rows: 0, skippedByHold: guard.skippedByHold };
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
    /**
     * `_storage` ids the action layer should propagate to RAG (DELETE
     * `/api/v1/documents/:fileId`). Round-2 V5 P0-13: chat-uploaded
     * files index by `storageId` directly (no `documents` row), so
     * RAG residue would otherwise survive Art 17 erasure indefinitely.
     */
    ragPurgeStorageIds: v.array(v.string()),
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
    const guard = await countOrSkip(
      ctx,
      args.organizationId,
      args.userId,
      iter,
    );
    if (guard.heldByOrgOrUser) {
      return {
        rows: 0,
        blobs: 0,
        ragPurgeStorageIds: [],
        skippedByHold: guard.skippedByHold,
      };
    }
    let rows = 0;
    let blobs = 0;
    const ragPurgeStorageIds: string[] = [];
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
      // Even if storage.delete failed, propagate to RAG so the index
      // is consistent with the (about-to-be-deleted) DB row.
      ragPurgeStorageIds.push(String(meta.storageId));
      await ctx.db.delete(meta._id);
      rows++;
    }
    return { rows, blobs, ragPurgeStorageIds, skippedByHold: 0 };
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
    const guard = await countOrSkip(
      ctx,
      args.organizationId,
      args.userId,
      iter,
    );
    if (guard.heldByOrgOrUser)
      return { rows: 0, skippedByHold: guard.skippedByHold };
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
    const guard = await countOrSkip(
      ctx,
      args.organizationId,
      args.userId,
      iter,
    );
    if (guard.heldByOrgOrUser)
      return { rows: 0, skippedByHold: guard.skippedByHold };
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
    const guard = await countOrSkip(
      ctx,
      args.organizationId,
      args.userId,
      iter,
    );
    if (guard.heldByOrgOrUser)
      return { rows: 0, skippedByHold: guard.skippedByHold };
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
    const guard = await countOrSkip(ctx, args.organizationId, args.userId, () =>
      (async function* () {
        for await (const row of iter()) {
          if (row.organizationId === args.organizationId) yield row;
        }
      })(),
    );
    if (guard.heldByOrgOrUser)
      return { rows: 0, skippedByHold: guard.skippedByHold };
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

/**
 * Round-2 V6 P0-17 — subject-scope erasure for `notifications` rows.
 *
 * Notifications carry the subject's email + (optionally) IP in
 * `params` (e.g. lockout alerts: "{email, ip, consecutiveFailures}").
 * When the audit pepper is configured, those fields are hashed; when
 * not, they're plaintext. Either form is personal data per Art 4(5) +
 * 17 and must be removed alongside the rest of the subject's footprint.
 *
 * Match strategy: walk the org's notifications via `by_org_created`,
 * compare `params.email` against (a) the subject's plaintext email
 * (looked up via `lookupSubjectEmail` and lowercased) and (b) the
 * peppered hash of that email. Either match → delete the row.
 */
export const eraseSubjectNotifications = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    /**
     * Resolved at the action layer via `lookupSubjectEmail` so the
     * mutation doesn't have to call into Better Auth (which is not
     * available from a Node-only mutation context). When the user's
     * email cannot be resolved (deleted account, etc.), the action
     * passes `null` and the mutation skips the email-match branch.
     */
    subjectEmail: v.union(v.string(), v.null()),
  },
  returns: v.object({ rows: v.number(), skippedByHold: v.number() }),
  handler: async (ctx, args) => {
    const holds = await loadActiveHolds(ctx, args.organizationId);
    if (holds.orgHeld || holds.userMembershipIds.has(args.userId)) {
      // Notifications under org-wide OR user-custodian hold are preserved
      // like every other category; the request was already refused at
      // scheduling time unless a hold landed mid-flight (round-2 v09 H4
      // + CRITICAL #14).
      return { rows: 0, skippedByHold: 0 };
    }
    const subjectEmailLc = args.subjectEmail?.toLowerCase() ?? null;
    const subjectEmailHash = subjectEmailLc
      ? await hashEmailForAudit(subjectEmailLc)
      : null;

    let rows = 0;
    for await (const row of ctx.db
      .query('notifications')
      .withIndex('by_org_created', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      const params = row.params;
      if (
        params === undefined ||
        params === null ||
        typeof params !== 'object'
      ) {
        continue;
      }
      // params is `jsonRecordValidator` (Record<string, unknown>) at the
      // schema layer but Convex hands it back as a generic JSON value;
      // narrow via Object.hasOwn + Reflect.get to avoid an unsafe cast.
      const paramEmail = Object.hasOwn(params, 'email')
        ? Reflect.get(params, 'email')
        : undefined;
      const matches =
        typeof paramEmail === 'string' &&
        ((subjectEmailLc !== null &&
          paramEmail.toLowerCase() === subjectEmailLc) ||
          (subjectEmailHash !== null && paramEmail === subjectEmailHash));
      if (!matches) continue;
      await ctx.db.delete(row._id);
      rows++;
    }
    return { rows, skippedByHold: 0 };
  },
});

export const eraseSubjectLoginAttempts = internalMutation({
  // Tables are email-keyed and global, but the GDPR request is org-scoped.
  // Re-read holds for the requesting org so a mid-flight hold blocks this
  // erasure too (round-2 v09 H4).
  args: {
    organizationId: v.string(),
    email: v.string(),
    /**
     * Subject userId — checked against `holds.userMembershipIds` so a
     * custodian hold placed on the user mid-flight also blocks this
     * email-keyed erasure. Round-2 review CRITICAL #14.
     */
    userId: v.string(),
  },
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
    if (holds.orgHeld || holds.userMembershipIds.has(args.userId)) {
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
      // Round-2 V5 P0-13: chat-uploaded files index by `storageId` (no
      // `documents` row, so the per-document RAG fan-out above misses
      // them). Fan out RAG DELETE for every storageId the fileMetadata
      // erasure touched so vector chunks containing PII are purged
      // alongside the DB row + the `_storage` blob.
      const fileMetaResult = perCategory.fileMetadata as {
        ragPurgeStorageIds?: string[];
      };
      for (const storageId of fileMetaResult.ragPurgeStorageIds ?? []) {
        try {
          const res = await ragFetch(
            `/api/v1/documents/${encodeURIComponent(storageId)}`,
            { method: 'DELETE', timeoutMs: 10_000 },
          );
          if (res.ok || res.status === 404) {
            ragDocumentsRemoved += 1;
          } else {
            console.warn(
              `[gdprErasure] RAG DELETE returned ${res.status} for chat-upload storageId=${storageId}`,
            );
          }
        } catch (error) {
          console.warn(
            `[gdprErasure] RAG DELETE failed for chat-upload storageId=${storageId}:`,
            error,
          );
        }
      }
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
      // user row itself is touched. The email is also handed to
      // `eraseSubjectNotifications` (round-2 V6 P0-17) so the
      // notifications walker can match either plaintext-email or
      // peppered-hash entries written by lockout alerts.
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
            userId: state.targetUserId,
          },
        );
      }
      await ctx.runMutation(
        internal.governance.erasure.eraseSubjectNotifications,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
          subjectEmail: subjectEmail ?? null,
        },
      );

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
  ragPurgeStorageIds?: string[];
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

// =============================================================================
// Watchdog + retry — round-2 V5 P0-14
// =============================================================================
//
// Convex actions hard-stop at 30 minutes. A subject with thousands of
// rows + RAG fan-out can blow that ceiling, leaving the request row
// stuck at `status: 'running'` forever — and the `ALREADY_PENDING`
// guard in `requestErasure` then refuses re-requests, silently letting
// the 30-day Art 12(3) SLA elapse with no path forward.
//
// Mirror of the transcription watchdog
// (`file_metadata/internal_mutations.ts:recoverStuckTranscriptions`):
// every 5 minutes, scan rows whose `status === 'running'` and
// `startedAt < now - 35 min`; flip them to `'failed'` with a watchdog
// error message so admins can call `retryErasureRequest`.

const ERASURE_WATCHDOG_TIMEOUT_MS = 35 * 60 * 1000;

export const recoverStuckErasureRequests = internalMutation({
  args: {},
  returns: v.object({ recovered: v.number() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - ERASURE_WATCHDOG_TIMEOUT_MS;
    let recovered = 0;
    for await (const row of ctx.db
      .query('gdprErasureRequests')
      .withIndex('by_status', (q) => q.eq('status', 'running'))) {
      const startedAt = row.startedAt ?? row.requestedAt;
      if (startedAt >= cutoff) continue;
      await ctx.db.patch(row._id, {
        status: 'failed',
        errorMessage: 'Erasure timed out (watchdog)',
        completedAt: Date.now(),
      });
      await createAuditLog(ctx, {
        organizationId: row.organizationId,
        actorId: 'system',
        actorEmail: 'system@tale.so',
        actorType: 'system',
        action: 'gdpr_erasure_watchdog_failed',
        category: 'admin',
        resourceType: 'user',
        resourceId: row.targetUserId,
        resourceName: row.targetUserId,
        status: 'failure',
        errorMessage: 'Erasure timed out (watchdog)',
        newState: { requestId: row._id, startedAt, cutoff },
      });
      recovered++;
    }
    return { recovered };
  },
});

/**
 * Admin-only retry for `'failed'` or `'blocked'` erasure requests. The
 * mutation flips the row back to `'pending'` and re-schedules the
 * processor. The hold gate re-runs at processor start (covers a hold
 * placed during the operator's "release hold then retry" interval).
 */
export const retryErasureRequest = mutation({
  args: { requestId: v.id('gdprErasureRequests') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const callerId = String(authUser._id);

    const row = await ctx.db.get(args.requestId);
    if (!row) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Erasure request does not exist.',
      });
    }

    const member = await getOrganizationMember(ctx, row.organizationId, {
      userId: callerId,
      email: authUser.email ?? '',
      name: authUser.name,
    });
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only org admins can retry erasure requests.',
      });
    }

    // `partial` is a re-runnable terminal state (some categories
    // skipped due to mid-flight hold; cascade hit page budget). Without
    // including it here, partial runs were unrecoverable from the UI —
    // the only retry surface is this mutation, the watchdog only
    // promotes `running` → `failed`, and `partial` would never reach the
    // retryable set. 30-day Art 12(3) SLA would silently elapse.
    // Round-2 review CRITICAL #12.
    if (
      row.status !== 'failed' &&
      row.status !== 'blocked' &&
      row.status !== 'partial'
    ) {
      throw new ConvexError({
        code: 'NOT_RETRIABLE',
        message: `Only failed, blocked, or partial requests can be retried (status=${row.status}).`,
      });
    }

    await ctx.db.patch(args.requestId, {
      status: 'pending',
      errorMessage: undefined,
      threadsBlockedByHold: undefined,
      documentsBlockedByHold: undefined,
      startedAt: undefined,
      completedAt: undefined,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.governance.erasure.processErasureRequest,
      { requestId: args.requestId },
    );

    await createAuditLog(ctx, {
      organizationId: row.organizationId,
      actorId: callerId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: 'gdpr_erasure_retried',
      category: 'admin',
      resourceType: 'user',
      resourceId: row.targetUserId,
      resourceName: row.targetUserId,
      status: 'success',
      previousState: { status: row.status },
      newState: { status: 'pending', requestId: args.requestId },
    });

    return null;
  },
});
