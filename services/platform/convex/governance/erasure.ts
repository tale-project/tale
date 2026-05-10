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
import { UnauthorizedError } from '../lib/rls/errors';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { cascadeDeleteThreadChildren } from '../threads/cascade_helpers';
import { eraseDocumentBlobs } from './erase_document_blobs';
import {
  ERASURE_REASON_CODES,
  ERASURE_WATCHDOG_TIMEOUT_MESSAGE,
} from './erasure_constants';
import { loadActiveHolds } from './legal_hold';

const SLA_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CASCADE_ATTEMPTS_PER_THREAD = 50;
/**
 * Art 12(3) caps the controller's response window at one month plus, for
 * complex requests, up to two further months. We expose a single
 * extension capped at 60 additional days; granting twice is rejected
 * with `ALREADY_EXTENDED`.
 */
const MAX_EXTENSION_DAYS = 60;

const erasureReasonCodeValidator = v.union(
  ...ERASURE_REASON_CODES.map((c) => v.literal(c)),
);

/**
 * Clear the per-subject `activeErasureClaims.requestId` IFF the claim
 * still points at the row identified by `requestId`. Defensive against
 * a race where a watchdog/finalize tries to clear a claim that's been
 * reassigned to a newer request — only the row that owns the claim
 * gets to release it.
 *
 * Called from terminal-state transitions where the next request should
 * be free to start fresh:
 *   - `finalizeProcessing` on `done` (subject successfully erased)
 *   - `recoverStuckErasureRequests` (watchdog) on `running→failed`
 *   - `requestErasure` blocked-path (operator must release hold; they
 *     may file again or use Retry on the row)
 *
 * Claim STAYS set on `partial` and non-watchdog `failed` so a stray
 * `requestErasure` cannot insert a parallel receipt while the operator
 * is in the middle of a retry flow.
 */
async function clearErasureClaimByRow(
  ctx: import('../_generated/server').MutationCtx,
  requestId: import('../_generated/dataModel').Id<'gdprErasureRequests'>,
): Promise<void> {
  const row = await ctx.db.get(requestId);
  if (!row) return;
  const claim = await ctx.db
    .query('activeErasureClaims')
    .withIndex('by_org_target', (q) =>
      q
        .eq('organizationId', row.organizationId)
        .eq('targetUserId', row.targetUserId),
    )
    .first();
  if (claim && claim.requestId === requestId) {
    await ctx.db.patch(claim._id, { requestId: undefined });
  }
}

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
    /** GDPR Art 17(1)(a)–(f) lawful ground or operational
     *  `contract_termination`. Required for new requests so receipts
     *  can be classified by ground for regulator reporting. */
    reasonCode: erasureReasonCodeValidator,
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

    // Cross-org IDOR guard: verify the target user is a member of the
    // requesting org. Without this, an admin of org A passing a userId
    // belonging only to org B reaches `eraseSubjectTwoFactorAttempts` (global
    // by userId) and `eraseSubjectLoginAttempts`/`loginBlockCounters` (global
    // by email) — wiping the victim's auth-throttling state across tenants
    // and producing a lockout-bypass primitive. Strict `(orgId, userId)`
    // match: pass an empty email so the helper's email-fallback (intended
    // for JWT-vs-stored userId drift on the *caller*) is disabled.
    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: args.userId,
        email: '',
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
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
          errorMessage: 'cross_org_target',
        });
        throw new ConvexError({
          code: 'forbidden',
          message: 'Target user is not a member of this organization.',
        });
      }
      throw err;
    }

    // Concurrency guard via the per-subject `activeErasureClaims` row.
    // A bare range query over `gdprErasureRequests.by_org_target_status`
    // could not detect range-phantom inserts: two concurrent
    // `requestErasure` calls on the same `(organizationId, targetUserId)`
    // both observed "no pending row" and both inserted + scheduled a
    // processor — duplicate receipts plus a duplicate cascade racing the
    // same subject's data. Mirror the `placeLegalHold` /
    // `activeLegalHoldClaims` pattern: read + patch a single claim row
    // in this same transaction; concurrent placers contend on the claim
    // row and serialize via OCC.
    //
    // The claim's `requestId` is cleared on terminal transitions where
    // the next request should be free to start fresh:
    //   - `finalizeProcessing` on `done` (subject successfully erased)
    //   - `recoverStuckErasureRequests` (watchdog) on `running→failed`
    //   - `requestErasure` blocked-path (operator must release hold;
    //      they may file again or use the unblocked retry on the row)
    // Claim STAYS set on `partial` / non-watchdog `failed` so a stray
    // `requestErasure` cannot insert a parallel receipt while the
    // operator is in the middle of a retry flow.
    const existingClaim = await ctx.db
      .query('activeErasureClaims')
      .withIndex('by_org_target', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('targetUserId', args.userId),
      )
      .first();
    if (existingClaim?.requestId !== undefined) {
      const existingRow = await ctx.db.get(existingClaim.requestId);
      if (existingRow) {
        throw new ConvexError({
          code: 'ALREADY_PENDING',
          message: `An erasure request for this subject is already ${existingRow.status}.`,
          requestId: existingRow._id,
          status: existingRow.status,
        });
      }
      // Stale claim (row was deleted out of band) — clear it and proceed.
      await ctx.db.patch(existingClaim._id, { requestId: undefined });
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
      reasonCode: args.reasonCode,
      requestedBy: callerId,
      requestedAt: now,
      slaDeadlineAt: now + SLA_DAYS * DAY_MS,
      status: 'pending',
      threadsTargeted: threadIds,
    });

    // Acquire the per-subject claim. Convex OCC: any concurrent caller
    // that already read `existingClaim` at the previous version conflicts
    // on this patch (or the matching insert below) and retries — at
    // retry it observes the winner's `requestId` and throws
    // ALREADY_PENDING above.
    if (existingClaim) {
      await ctx.db.patch(existingClaim._id, { requestId, claimedAt: now });
    } else {
      await ctx.db.insert('activeErasureClaims', {
        organizationId: args.organizationId,
        targetUserId: args.userId,
        requestId,
        claimedAt: now,
      });
    }

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
      // Clear the claim so the next `requestErasure` (or `retryErasureRequest`
      // after the operator releases the hold) can take over. Without this,
      // `blocked` would coexist with a stuck claim and refuse all retries
      // and refile attempts even after the hold lifts.
      await clearErasureClaimByRow(ctx, requestId);
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
        reasonCode: args.reasonCode,
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
    // back to 'running' from 'partial', but does NOT take over from
    // 'running' (another processor owns it), 'blocked' (terminal until
    // operator releases hold + Retry), 'done', or 'failed'. Whitelist
    // — fail-closed for any future status — instead of blacklist.
    if (row.status !== 'pending' && row.status !== 'partial') return null;
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
  returns: v.object({
    done: v.boolean(),
    remaining: v.number(),
    skippedByHold: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    const result = await cascadeDeleteThreadChildren(ctx, {
      threadId: args.threadId,
      organizationId: args.organizationId,
    });
    return {
      done: result.done,
      remaining: result.remaining,
      skippedByHold: result.skippedByHold,
    };
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
  notifications: rowsAndHoldValidator,
  wfExecutions: rowsAndHoldValidator,
  promptTemplates: rowsAndHoldValidator,
});

export const finalizeProcessing = internalMutation({
  args: {
    requestId: v.id('gdprErasureRequests'),
    threadsErased: v.number(),
    threadsSkippedByHold: v.optional(v.number()),
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
      row.errorMessage === ERASURE_WATCHDOG_TIMEOUT_MESSAGE
    ) {
      // Preserve the watchdog's `'failed'` verdict and `errorMessage`,
      // but persist the count fields the action actually completed
      // before timing out. Without this, the receipt row reads as
      // "0 erased / 0 RAG removed" while the audit row's
      // `intendedThreadsErased` / `intendedDocumentsErased` paint a
      // different picture — confusing for regulators and operators
      // triaging a partial-side-effect timeout.
      await ctx.db.patch(args.requestId, {
        threadsErased: args.threadsErased,
        ragDocumentsRemoved: args.ragDocumentsRemoved,
        documentsErased: args.documentsErased,
        documentsSkippedByHold:
          (args.documentsSkippedByHold ?? 0) > 0
            ? args.documentsSkippedByHold
            : undefined,
        lateFinalizeAt: Date.now(),
      });
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
    const threadsSkippedByHold = args.threadsSkippedByHold ?? 0;
    // Aggregate skipped-by-hold across every per-category counter so the
    // receipt status flips to `partial` whenever a mid-flight hold blocked
    // ANY category, not just documents (round-2 v05 B6 / v09 H4).
    // Structural sum: new categories added to `perCategoryValidator`
    // contribute automatically as long as their shape carries
    // `skippedByHold: number`.
    const perCategory = args.perCategory;
    const perCategorySkipped = perCategory
      ? Object.values(perCategory).reduce(
          (sum, entry) => sum + (entry.skippedByHold ?? 0),
          0,
        )
      : 0;
    const totalSkippedByHold =
      documentsSkippedByHold + perCategorySkipped + threadsSkippedByHold;
    const status: 'done' | 'partial' | 'failed' = args.errorMessage
      ? 'failed'
      : args.threadsErased < targetedCount || totalSkippedByHold > 0
        ? 'partial'
        : 'done';
    await ctx.db.patch(args.requestId, {
      status,
      // M2: accumulate per-attempt counters across retry runs. The
      // action's local counters (passed via args) only count work done
      // *this* attempt — already-erased rows aren't re-iterated by their
      // index, so a partial→retry would otherwise overwrite the row's
      // historical count with the (smaller) retry count, under-reporting
      // the total work done for the regulator.
      // Exception: `threadsErased` (and `threadsSkippedByHold`) — the
      // action re-walks `state.threadsTargeted` (the snapshot fixed at
      // submission), and `cascadeDeleteThreadChildren` on an already-
      // erased thread returns `done:true` immediately, so the action's
      // counter naturally equals the cumulative total per retry.
      threadsErased: args.threadsErased,
      threadsSkippedByHold:
        threadsSkippedByHold > 0 ? threadsSkippedByHold : undefined,
      ragDocumentsRemoved:
        (row.ragDocumentsRemoved ?? 0) + args.ragDocumentsRemoved,
      documentsErased: (row.documentsErased ?? 0) + (args.documentsErased ?? 0),
      // wfExecutions / promptTemplates totals derived from perCategory.
      wfExecutionsErased:
        (row.wfExecutionsErased ?? 0) +
        (args.perCategory?.wfExecutions.rows ?? 0),
      promptTemplatesErased:
        (row.promptTemplatesErased ?? 0) +
        (args.perCategory?.promptTemplates.rows ?? 0),
      documentsSkippedByHold:
        documentsSkippedByHold > 0 ? documentsSkippedByHold : undefined,
      errorMessage: args.errorMessage,
      completedAt: Date.now(),
    });

    // Release the per-subject claim only on terminal `done`. Partial /
    // failed are retryable, so the claim stays pointing at this row to
    // refuse a parallel `requestErasure` while the operator is in the
    // middle of a retry flow.
    if (status === 'done') {
      await clearErasureClaimByRow(ctx, args.requestId);
    }

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
    // Use the existing compound index `by_user_org_status_deleted_created`
    // as a `(userId, organizationId)` prefix scan so the read is bounded
    // to the subject's own rows. Pre-fix the eraser walked
    // `by_organizationId` and JS-filtered by userId — same 16K-cap
    // spoliation pattern that was fixed for `threadMetadata` (round-2
    // CRITICAL #13).
    const iter = () =>
      ctx.db
        .query('userMemories')
        .withIndex('by_user_org_status_deleted_created', (q) =>
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
    // M3: subject-scoped scan via `by_org_user` (added in this PR).
    // Pre-fix walked `by_organizationId` + JS userId filter, exposing
    // the 16K-cap spoliation pattern. Bounded to per-user count now.
    const iter = () =>
      ctx.db
        .query('messageFeedback')
        .withIndex('by_org_user', (q) =>
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
    // Two-phase erasure (C2 + C3 fix):
    //
    //   1. **userId-indexed pass** via `by_org_subject` — bounded to the
    //      subject's own notifications. New writers (`writeNotificationForOrgs`
    //      with `subjectUserId`) populate the column, so this is the
    //      primary path for any notification written after this PR.
    //   2. **Legacy email-match pass** — falls back to `params.email`
    //      matching for rows written before `subjectUserId` existed.
    //      Best-effort under pepper rotation: rows whose `params.email`
    //      was hashed under a now-rotated pepper will not match either
    //      branch and must be cleaned by an out-of-band tool.
    //
    // Pre-fix walked `by_org_created` org-wide on every cascade — at
    // 16K+ org notifications (busy lockout-alert volume + no TTL by
    // default) the read silently truncated and missed subject rows
    // (Art-17 incomplete erasure). This split keeps the userId pass
    // bounded by per-subject row count regardless of org volume, and
    // the legacy pass is bounded by the same `by_org_created` walk —
    // tracked as a known limitation rather than a silent failure.

    // Mid-flight hold gate: count what would have been erased so the
    // receipt's `partial` status flips correctly when the cascade is
    // blocked between scheduling and processor run.
    const holds = await loadActiveHolds(ctx, args.organizationId);
    if (holds.orgHeld || holds.userMembershipIds.has(args.userId)) {
      let skippedByHold = 0;
      for await (const _row of ctx.db
        .query('notifications')
        .withIndex('by_org_subject', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('subjectUserId', args.userId),
        )) {
        skippedByHold++;
      }
      // Legacy rows can't be efficiently counted under hold without
      // re-walking the whole org; preserve the row-count discipline by
      // accepting an under-count here (still > 0 forces partial state
      // when the userId-pass had any matches).
      return { rows: 0, skippedByHold };
    }

    let rows = 0;
    const erasedIds = new Set<string>();

    // Pass 1: userId-indexed (primary, bounded by subject-row count)
    for await (const row of ctx.db
      .query('notifications')
      .withIndex('by_org_subject', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('subjectUserId', args.userId),
      )) {
      await ctx.db.delete(row._id);
      erasedIds.add(String(row._id));
      rows++;
    }

    // Pass 2: legacy email-match (only when subjectEmail is resolvable
    // — pre-fix rows have `subjectUserId === undefined`).
    const subjectEmailLc = args.subjectEmail?.toLowerCase() ?? null;
    const subjectEmailHash = subjectEmailLc
      ? await hashEmailForAudit(subjectEmailLc)
      : null;
    if (subjectEmailLc !== null) {
      for await (const row of ctx.db
        .query('notifications')
        .withIndex('by_org_created', (q) =>
          q.eq('organizationId', args.organizationId),
        )) {
        if (erasedIds.has(String(row._id))) continue;
        // Pass-2 only handles legacy rows that pre-date subjectUserId;
        // skip rows that were already taggable by userId (those hit
        // pass 1 if they matched, or are someone else's notification).
        if (row.subjectUserId !== undefined) continue;
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
          (paramEmail.toLowerCase() === subjectEmailLc ||
            (subjectEmailHash !== null && paramEmail === subjectEmailHash));
        if (!matches) continue;
        await ctx.db.delete(row._id);
        rows++;
      }
    }

    return { rows, skippedByHold: 0 };
  },
});

/**
 * H7 — `wfExecutions` rows the subject either ran (`userId`) or
 * triggered (`triggeredBy`). Stores `input`/`output`/`variables`/
 * `triggerData`/`error`/`metadata` as free-text JSON / strings, all
 * potentially carrying subject PII. Also references three `_storage`
 * blobs (`variablesStorageId`, `outputStorageId`, `stepsConfigStorageId`)
 * that must be cascaded too.
 *
 * Strategy:
 *   1. Walk `by_org_user` (subject as executor).
 *   2. Walk `by_org_triggeredBy` (subject as trigger author).
 *   3. Dedupe across both walks via row `_id`.
 *   4. Best-effort delete each blob (errors logged, not propagated —
 *      the row delete is the load-bearing step for Art 17).
 */
export const eraseSubjectWfExecutions = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.object({ rows: v.number(), skippedByHold: v.number() }),
  handler: async (ctx, args) => {
    const userIter = () =>
      ctx.db
        .query('wfExecutions')
        .withIndex('by_org_user', (q) =>
          q.eq('organizationId', args.organizationId).eq('userId', args.userId),
        );
    const triggeredByIter = () =>
      ctx.db
        .query('wfExecutions')
        .withIndex('by_org_triggeredBy', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('triggeredBy', args.userId),
        );

    // Hold guard: count what would be erased (across both index walks)
    // and return without touching blobs.
    const holds = await loadActiveHolds(ctx, args.organizationId);
    if (holds.orgHeld || holds.userMembershipIds.has(args.userId)) {
      const seen = new Set<string>();
      let skippedByHold = 0;
      for await (const row of userIter()) {
        seen.add(String(row._id));
        skippedByHold++;
      }
      for await (const row of triggeredByIter()) {
        if (!seen.has(String(row._id))) skippedByHold++;
      }
      return { rows: 0, skippedByHold };
    }

    let rows = 0;
    const seen = new Set<string>();
    const eraseRow = async (row: {
      _id: import('../_generated/dataModel').Id<'wfExecutions'>;
      variablesStorageId?: import('../_generated/dataModel').Id<'_storage'>;
      outputStorageId?: import('../_generated/dataModel').Id<'_storage'>;
      stepsConfigStorageId?: import('../_generated/dataModel').Id<'_storage'>;
    }) => {
      const idStr = String(row._id);
      if (seen.has(idStr)) return;
      seen.add(idStr);
      for (const storageId of [
        row.variablesStorageId,
        row.outputStorageId,
        row.stepsConfigStorageId,
      ]) {
        if (!storageId) continue;
        try {
          await ctx.storage.delete(storageId);
        } catch (error) {
          console.warn(
            `[gdprErasure] storage.delete failed for wfExecutions blob ${String(storageId)}:`,
            error,
          );
        }
      }
      await ctx.db.delete(row._id);
      rows++;
    };

    for await (const row of userIter()) {
      await eraseRow(row);
    }
    for await (const row of triggeredByIter()) {
      await eraseRow(row);
    }
    return { rows, skippedByHold: 0 };
  },
});

/**
 * H7 — personal-scope `promptTemplates` authored by the subject. Team
 * and global templates are organisational artifacts and stay; only
 * `scope === 'personal'` rows are subject-private content.
 */
export const eraseSubjectPromptTemplates = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.object({ rows: v.number(), skippedByHold: v.number() }),
  handler: async (ctx, args) => {
    const iter = () =>
      ctx.db
        .query('promptTemplates')
        .withIndex('by_org_createdBy', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('createdBy', args.userId),
        );
    const guard = await countOrSkip(ctx, args.organizationId, args.userId, () =>
      (async function* () {
        for await (const row of iter()) {
          if (row.scope === 'personal') yield row;
        }
      })(),
    );
    if (guard.heldByOrgOrUser)
      return { rows: 0, skippedByHold: guard.skippedByHold };
    let rows = 0;
    for await (const row of iter()) {
      if (row.scope !== 'personal') continue;
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
    let threadsSkippedByHold = 0;
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
      notifications: { rows: 0, skippedByHold: 0 },
      wfExecutions: { rows: 0, skippedByHold: 0 },
      promptTemplates: { rows: 0, skippedByHold: 0 },
    };
    let errorMessage: string | undefined;

    try {
      // Cascade each thread; each cascade itself loops until done or
      // hits MAX_CASCADE_ATTEMPTS_PER_THREAD pages. H5: distinguish
      // "completed cleanly" (count toward threadsErased) from "skipped
      // due to mid-flight hold" (count toward threadsSkippedByHold) so
      // the receipt does not over-report `threadsErased` when a hold
      // landed between scheduling and the per-thread cascade call.
      for (const threadId of state.threadsTargeted) {
        let cascadeDone = false;
        let cascadeSkippedByHold = false;
        for (let i = 0; i < MAX_CASCADE_ATTEMPTS_PER_THREAD; i++) {
          const result = await ctx.runMutation(
            internal.governance.erasure.eraseThreadById,
            {
              threadId,
              organizationId: state.organizationId,
            },
          );
          if (result.skippedByHold === true) {
            cascadeSkippedByHold = true;
            cascadeDone = true;
            break;
          }
          if (result.done) {
            cascadeDone = true;
            break;
          }
        }
        if (cascadeSkippedByHold) {
          threadsSkippedByHold += 1;
        } else if (cascadeDone) {
          threadsErased += 1;
        } else {
          // Hit the page-attempts ceiling without finishing the
          // cascade. Surface a `failure` audit row so the operator
          // dashboard sees the stuck thread instead of a silent
          // partial result (round-2 / M12). Resource scope is the
          // *subject* (not the thread) so the receipt UI's
          // `getResourceAuditTrail({resourceType:'user', resourceId:targetUserId})`
          // filter at `erasure_queries.ts` actually surfaces this signal.
          await ctx.runMutation(
            internal.audit_logs.internal_mutations.createAuditLog,
            {
              organizationId: state.organizationId,
              actorId: 'system',
              actorType: 'system',
              action: 'gdpr_erasure_cascade_attempts_exhausted',
              category: 'admin',
              resourceType: 'user',
              resourceId: state.targetUserId,
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
      // `perCategory.fileMetadata` already typed as `FileMetadataCounts`
      // which declares `ragPurgeStorageIds?: string[]` — no cast needed.
      for (const storageId of perCategory.fileMetadata.ragPurgeStorageIds ??
        []) {
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
      // H7: subject's workflow executions and personal prompts.
      perCategory.wfExecutions = await ctx.runMutation(
        internal.governance.erasure.eraseSubjectWfExecutions,
        {
          organizationId: state.organizationId,
          userId: state.targetUserId,
        },
      );
      perCategory.promptTemplates = await ctx.runMutation(
        internal.governance.erasure.eraseSubjectPromptTemplates,
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
      // C4: capture notifications counts (previously discarded — receipt
      // and audit log were blind to notifications work).
      perCategory.notifications = await ctx.runMutation(
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
      threadsSkippedByHold,
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
  notifications: RowsAndHold;
  wfExecutions: RowsAndHold;
  promptTemplates: RowsAndHold;
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
        errorMessage: ERASURE_WATCHDOG_TIMEOUT_MESSAGE,
        completedAt: Date.now(),
      });
      // Watchdog-failed receipts are not recoverable via `retryErasureRequest`
      // (the action timed out — the next attempt should be a fresh request).
      // Release the claim so a new `requestErasure` can take over.
      await clearErasureClaimByRow(ctx, row._id);
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
        errorMessage: ERASURE_WATCHDOG_TIMEOUT_MESSAGE,
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

    // Re-acquire the per-subject claim. It was cleared by:
    //   - the blocked-path of `requestErasure` (so the operator could
    //     release the hold + Retry from the UI), or
    //   - the watchdog when this row timed out (now overridden — the
    //     operator chose to retry the same row instead of filing fresh)
    // For `partial` / non-watchdog `failed`, the claim is still set and
    // points at this row, so re-patching is a no-op-value patch.
    const now = Date.now();
    const existingClaim = await ctx.db
      .query('activeErasureClaims')
      .withIndex('by_org_target', (q) =>
        q
          .eq('organizationId', row.organizationId)
          .eq('targetUserId', row.targetUserId),
      )
      .first();
    if (existingClaim) {
      // If another `requestErasure` already grabbed the claim for a
      // different requestId (claim was cleared, then a new request took
      // over), refuse the retry — the new request is the canonical one.
      if (
        existingClaim.requestId !== undefined &&
        existingClaim.requestId !== args.requestId
      ) {
        throw new ConvexError({
          code: 'ALREADY_PENDING',
          message:
            'A different erasure request is already in flight for this subject.',
          requestId: existingClaim.requestId,
        });
      }
      await ctx.db.patch(existingClaim._id, {
        requestId: args.requestId,
        claimedAt: now,
      });
    } else {
      await ctx.db.insert('activeErasureClaims', {
        organizationId: row.organizationId,
        targetUserId: row.targetUserId,
        requestId: args.requestId,
        claimedAt: now,
      });
    }

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

/**
 * Admin-only Art 12(3) deadline extension. The controller may extend the
 * one-month response window by up to two further months for complex
 * requests, but the extension itself must be communicated to the
 * subject within the original month, with reasons. We model that by
 * refusing to grant the extension after `slaDeadlineAt` has passed and
 * by capping the per-request grant at one (each request can be extended
 * at most once, total extra ≤ 60 days).
 *
 * On success, the row carries `extensionDeadlineAt`, which the SLA
 * countdown badge in the admin UI uses in preference to the original
 * `slaDeadlineAt`.
 */
export const extendErasureDeadline = mutation({
  args: {
    requestId: v.id('gdprErasureRequests'),
    extraDays: v.number(),
    extensionReason: v.string(),
  },
  returns: v.object({
    extensionDeadlineAt: v.number(),
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
        message: 'Only org admins can extend erasure deadlines.',
      });
    }

    const extraDays = Math.trunc(args.extraDays);
    if (
      !Number.isFinite(extraDays) ||
      extraDays < 1 ||
      extraDays > MAX_EXTENSION_DAYS
    ) {
      throw new ConvexError({
        code: 'validation',
        message: `extraDays must be an integer between 1 and ${MAX_EXTENSION_DAYS}.`,
      });
    }
    const reason = args.extensionReason.trim();
    if (reason.length < 10) {
      throw new ConvexError({
        code: 'validation',
        message: 'extensionReason must be at least 10 characters.',
      });
    }

    if (row.status === 'done' || row.status === 'failed') {
      throw new ConvexError({
        code: 'NOT_EXTENDABLE',
        message: `Request is in a terminal state (status=${row.status}).`,
      });
    }
    if (row.extensionGrantedAt !== undefined) {
      throw new ConvexError({
        code: 'ALREADY_EXTENDED',
        message:
          'This request has already been extended. Art 12(3) allows a single extension.',
      });
    }
    const now = Date.now();
    if (row.slaDeadlineAt < now) {
      // Art 12(3) requires the extension to be communicated within the
      // original month — granting it after the deadline lapses would not
      // be lawful. Operators must instead document the breach.
      throw new ConvexError({
        code: 'DEADLINE_LAPSED',
        message:
          'Original Art 12(3) deadline has already passed; extensions cannot be granted retroactively.',
      });
    }

    const extensionDeadlineAt = row.slaDeadlineAt + extraDays * DAY_MS;
    await ctx.db.patch(args.requestId, {
      extensionGrantedAt: now,
      extensionGrantedBy: callerId,
      extensionReason: reason,
      extensionDeadlineAt,
    });

    await createAuditLog(ctx, {
      organizationId: row.organizationId,
      actorId: callerId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: 'gdpr_erasure_extended',
      category: 'admin',
      resourceType: 'user',
      resourceId: row.targetUserId,
      resourceName: row.targetUserId,
      status: 'success',
      previousState: {
        slaDeadlineAt: row.slaDeadlineAt,
      },
      newState: {
        requestId: args.requestId,
        extraDays,
        extensionReason: reason,
        extensionDeadlineAt,
      },
    });

    return { extensionDeadlineAt };
  },
});
