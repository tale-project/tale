import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { deleteStorageWithMetadata } from '../file_metadata/helpers';
import { cascadeDeleteThreadChildren } from '../threads/cascade_helpers';
import { eraseDocumentBlobs } from './erase_document_blobs';
import { loadActiveHolds } from './legal_hold';

/**
 * Per-row pre-flight before a retention-driven delete. Closes three
 * round-2-confirmed holes:
 *
 *   1. **Snapshot-race vs legal hold (W1 #4)** — the dispatcher's
 *      `loadActiveHoldsForOrg` snapshot is up to 25 min stale; a hold
 *      placed mid-run otherwise gets zero protection. Re-read inside
 *      every per-row mutation so the only authoritative gate is at the
 *      delete boundary.
 *   2. **Cross-org corruption (W6 #10)** — every mutation here trusts
 *      `args.organizationId` blindly; a swapped id silently deletes
 *      org A's row while logging the audit under org B. Verify the
 *      row's own `organizationId` matches.
 *   3. **TOCTOU on cutoff (W4 #13)** — between the dispatcher's
 *      `listExpiredX(cutoffMs)` and the per-row delete a user can
 *      re-touch the row (chat thread updatedAt bump, document patch).
 *      Re-evaluate the cutoff against `(updatedAt ?? _creationTime)`.
 *
 * Returns `{ proceed: true }` to permit the delete, or
 * `{ proceed: false, reason }` so the caller can return early with a
 * clear log.
 */
export async function assertSafeRetentionDelete(
  ctx: MutationCtx,
  args: {
    rowOrganizationId: string | undefined;
    expectedOrganizationId: string;
    rowEffectiveMs: number;
    cutoffMs: number | undefined;
    /**
     * Row's author / owner user id. When provided, the gate refuses if
     * that user is on a custodian (`userMembership`) legal hold —
     * closing the spoliation window where retention's mid-flight per-
     * row guard previously ignored cascade through to the row's author
     * (round-2 V3 P0).
     *
     * Pass `doc.createdBy` for documents, `thread.userId` for threads,
     * `feedback.userId` for feedback, etc. When the row has no
     * meaningful author concept (CRM tables), omit and only org-wide
     * holds gate the delete.
     */
    authorUserId?: string;
  },
): Promise<{ proceed: true } | { proceed: false; reason: string }> {
  if (args.rowOrganizationId !== args.expectedOrganizationId) {
    return { proceed: false, reason: 'cross-org mismatch' };
  }
  if (args.cutoffMs !== undefined && args.rowEffectiveMs >= args.cutoffMs) {
    // Row was re-touched since the dispatcher listed it; let the user
    // keep their fresh edit.
    return { proceed: false, reason: 'row no longer expired (TOCTOU)' };
  }
  const holds = await loadActiveHolds(ctx, args.expectedOrganizationId);
  if (holds.orgHeld) return { proceed: false, reason: 'org legal hold' };
  if (args.authorUserId && holds.userMembershipIds.has(args.authorUserId)) {
    return { proceed: false, reason: 'user-custodian legal hold' };
  }
  return { proceed: true };
}

export const deleteExpiredDocument = internalMutation({
  args: {
    documentId: v.id('documents'),
    organizationId: v.string(),
    cutoffMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) {
      return null;
    }

    const guard = await assertSafeRetentionDelete(ctx, {
      rowOrganizationId: doc.organizationId,
      expectedOrganizationId: args.organizationId,
      rowEffectiveMs: doc._creationTime,
      cutoffMs: args.cutoffMs,
      authorUserId: doc.createdBy ?? undefined,
    });
    if (!guard.proceed) {
      console.info(
        `[RetentionCleanup] skipping deleteExpiredDocument(${String(args.documentId)}): ${guard.reason}`,
      );
      return null;
    }

    await eraseDocumentBlobs(ctx, doc);
    await ctx.db.delete(args.documentId);

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorEmail: 'system@tale.so',
      actorType: 'system',
      action: 'document.retention_deleted',
      category: 'data',
      resourceType: 'document',
      resourceId: String(args.documentId),
      resourceName: doc.title ?? 'Untitled',
      status: 'success',
    });

    return null;
  },
});

export const deleteExpiredTempFile = internalMutation({
  args: {
    fileMetadataId: v.id('fileMetadata'),
    organizationId: v.string(),
    cutoffMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const metadata = await ctx.db.get(args.fileMetadataId);
    if (!metadata) {
      return null;
    }

    const guard = await assertSafeRetentionDelete(ctx, {
      rowOrganizationId: metadata.organizationId,
      expectedOrganizationId: args.organizationId,
      rowEffectiveMs: metadata._creationTime,
      cutoffMs: args.cutoffMs,
    });
    if (!guard.proceed) {
      console.info(
        `[RetentionCleanup] skipping deleteExpiredTempFile(${String(args.fileMetadataId)}): ${guard.reason}`,
      );
      return null;
    }

    await deleteStorageWithMetadata(ctx, metadata.storageId);
    return null;
  },
});

/**
 * Pass-A retention soft-flip: an active thread that's past its
 * retention window gets `status='expired'` so it enters the admin
 * Trash window for `deletionGraceDays` before the next sweep cascades
 * it. Idempotent: if the row is already trashed/expired/deleted, no-op.
 */
export const markThreadExpired = internalMutation({
  args: {
    threadMetadataId: v.id('threadMetadata'),
    organizationId: v.string(),
    cutoffMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadMetadataId);
    if (!thread) return null;

    const guard = await assertSafeRetentionDelete(ctx, {
      rowOrganizationId: thread.organizationId,
      expectedOrganizationId: args.organizationId,
      rowEffectiveMs:
        thread.updatedAt ?? thread.createdAt ?? thread._creationTime,
      cutoffMs: args.cutoffMs,
      authorUserId: thread.userId,
    });
    if (!guard.proceed) {
      console.info(
        `[RetentionCleanup] skipping markThreadExpired(${thread.threadId}): ${guard.reason}`,
      );
      return null;
    }

    // Only flip from 'active' (or unset legacy rows). Don't reset
    // statusChangedAt for rows already in the trash/expired window —
    // that would extend the grace clock indefinitely.
    const status = thread.status ?? 'active';
    if (status !== 'active') return null;

    const now = Date.now();
    await ctx.db.patch(args.threadMetadataId, {
      status: 'expired',
      statusChangedAt: now,
    });

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorEmail: 'system@tale.so',
      actorType: 'system',
      action: 'chat_history.retention_expired',
      category: 'data',
      resourceType: 'thread',
      resourceId: thread.threadId,
      resourceName: thread.title ?? 'Untitled',
      status: 'success',
      newState: { previousStatus: status, newStatus: 'expired' },
    });
    return null;
  },
});

export const deleteExpiredThread = internalMutation({
  args: {
    threadMetadataId: v.id('threadMetadata'),
    organizationId: v.string(),
    cutoffMs: v.optional(v.number()),
  },
  returns: v.object({
    done: v.boolean(),
    remaining: v.number(),
  }),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadMetadataId);
    if (!thread) {
      return { done: true, remaining: 0 };
    }

    const guard = await assertSafeRetentionDelete(ctx, {
      rowOrganizationId: thread.organizationId,
      expectedOrganizationId: args.organizationId,
      rowEffectiveMs:
        thread.updatedAt ?? thread.createdAt ?? thread._creationTime,
      cutoffMs: args.cutoffMs,
      authorUserId: thread.userId,
    });
    if (!guard.proceed) {
      console.info(
        `[RetentionCleanup] skipping deleteExpiredThread(${thread.threadId}): ${guard.reason}`,
      );
      return { done: true, remaining: 0 };
    }

    // Use the shared cascade helper so user-delete and retention-delete
    // can never drift on which descendant tables get cleaned up. cascade
    // also re-checks the hold internally as defense-in-depth.
    const result = await cascadeDeleteThreadChildren(ctx, {
      threadId: thread.threadId,
      organizationId: args.organizationId,
    });

    if (result.done) {
      await createAuditLog(ctx, {
        organizationId: args.organizationId,
        actorId: 'system',
        actorEmail: 'system@tale.so',
        actorType: 'system',
        action: 'chat_history.retention_deleted',
        category: 'data',
        resourceType: 'thread',
        resourceId: thread.threadId,
        resourceName: thread.title ?? 'Untitled',
        status: 'success',
      });
    }

    return result;
  },
});

export const deleteExpiredWorkflowExecution = internalMutation({
  args: {
    executionId: v.id('wfExecutions'),
    organizationId: v.string(),
    cutoffMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (!execution) {
      return null;
    }

    const guard = await assertSafeRetentionDelete(ctx, {
      rowOrganizationId: execution.organizationId,
      expectedOrganizationId: args.organizationId,
      rowEffectiveMs: execution._creationTime,
      cutoffMs: args.cutoffMs,
      authorUserId: execution.userId ?? undefined,
    });
    if (!guard.proceed) {
      console.info(
        `[RetentionCleanup] skipping deleteExpiredWorkflowExecution(${String(args.executionId)}): ${guard.reason}`,
      );
      return null;
    }

    for (const storageId of [
      execution.variablesStorageId,
      execution.outputStorageId,
      execution.stepsConfigStorageId,
    ]) {
      if (storageId) {
        try {
          await ctx.storage.delete(storageId);
        } catch (error) {
          console.warn(
            `[RetentionCleanup] Failed to delete storage ${storageId} for execution ${execution._id}:`,
            error,
          );
        }
      }
    }

    await ctx.db.delete(args.executionId);

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorEmail: 'system@tale.so',
      actorType: 'system',
      action: 'workflow_execution.retention_deleted',
      category: 'data',
      resourceType: 'wf_execution',
      resourceId: String(args.executionId),
      resourceName: execution.workflowSlug ?? 'unknown',
      status: 'success',
    });

    return null;
  },
});

export const deleteExpiredWorkflowTriggerLog = internalMutation({
  args: {
    triggerLogId: v.id('wfTriggerLogs'),
    organizationId: v.string(),
    cutoffMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const log = await ctx.db.get(args.triggerLogId);
    if (!log) {
      return null;
    }

    // Resolve the trigger log's underlying execution (if linked) to
    // surface the parent's `userId` for the custodian-cascade check.
    // After the legal-hold simplification (`HOLD_TARGET_TYPES` narrowed
    // to `org` + `userMembership`), per-execution holds no longer exist;
    // the cascade flows through the user that triggered the execution.
    let authorUserId: string | undefined;
    if (log.wfExecutionId) {
      const exec = await ctx.db.get(log.wfExecutionId);
      authorUserId = exec?.userId ?? undefined;
    }

    const guard = await assertSafeRetentionDelete(ctx, {
      rowOrganizationId: log.organizationId,
      expectedOrganizationId: args.organizationId,
      rowEffectiveMs: log._creationTime,
      cutoffMs: args.cutoffMs,
      authorUserId,
    });
    if (!guard.proceed) {
      console.info(
        `[RetentionCleanup] skipping deleteExpiredWorkflowTriggerLog(${String(args.triggerLogId)}): ${guard.reason}`,
      );
      return null;
    }

    await ctx.db.delete(args.triggerLogId);

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorEmail: 'system@tale.so',
      actorType: 'system',
      action: 'workflow_trigger_log.retention_deleted',
      category: 'data',
      resourceType: 'wf_trigger_log',
      resourceId: String(args.triggerLogId),
      status: 'success',
    });

    return null;
  },
});

/**
 * Sweep an expired pending-retention-shortening row. After `appliesAt`
 * has elapsed the cooldown is over; the policy row already holds the
 * new config (saved at upsert time), so all this does is remove the
 * pending marker. Idempotent.
 */
/**
 * Upsert the per-org applied bounds row + emit audit. Idempotent:
 * re-applying the same hash leaves `appliedBounds` unchanged but
 * refreshes `appliedAt` / `appliedBy`.
 *
 * Always clears `rejectedBoundsHash` / `rejectedAt` / `rejectedBy` —
 * a fresh apply means any prior rejection is no longer the standing
 * decision, so the next reject starts from a clean state.
 *
 * `auditAction` lets callers distinguish:
 *   - `policy.retention_bounds_proposal_applied` (admin click)
 *   - `policy.retention_bounds_initial_applied` (first-enable seed,
 *      migration)
 */
export const upsertAppliedBounds = internalMutation({
  args: {
    organizationId: v.string(),
    appliedBounds: v.any(),
    appliedBoundsHash: v.string(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
    actorType: v.union(v.literal('user'), v.literal('system')),
    auditAction: v.string(),
  },
  returns: v.id('retentionAppliedBounds'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('retentionAppliedBounds')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    const now = Date.now();
    let rowId;
    let previousState: Record<string, unknown> | undefined;
    if (existing) {
      previousState = {
        appliedBounds: existing.appliedBounds,
        appliedBoundsHash: existing.appliedBoundsHash,
      };
      await ctx.db.patch(existing._id, {
        appliedBounds: args.appliedBounds,
        appliedBoundsHash: args.appliedBoundsHash,
        appliedAt: now,
        appliedBy: args.actorId,
        rejectedBoundsHash: undefined,
        rejectedAt: undefined,
        rejectedBy: undefined,
      });
      rowId = existing._id;
    } else {
      rowId = await ctx.db.insert('retentionAppliedBounds', {
        organizationId: args.organizationId,
        appliedBounds: args.appliedBounds,
        appliedBoundsHash: args.appliedBoundsHash,
        appliedAt: now,
        appliedBy: args.actorId,
      });
    }
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      actorEmail: args.actorEmail,
      actorType: args.actorType,
      action: args.auditAction,
      category: 'security',
      resourceType: 'governance_policy',
      resourceId: String(rowId),
      resourceName: 'retention_bounds',
      previousState,
      newState: {
        appliedBounds: args.appliedBounds,
        appliedBoundsHash: args.appliedBoundsHash,
      },
      status: 'success',
    });
    return rowId;
  },
});

/**
 * Record the most recent rejection + emit audit. Banner stays hidden
 * while the operator's current effective hash matches
 * `rejectedBoundsHash` (and differs from `appliedBoundsHash`).
 * `appliedBounds` itself is unchanged — cleanup keeps using the
 * previously-agreed config.
 */
export const setRejectedBounds = internalMutation({
  args: {
    organizationId: v.string(),
    rejectedBoundsHash: v.string(),
    proposedBounds: v.any(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('retentionAppliedBounds')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    if (!existing) {
      throw new Error(
        `setRejectedBounds: no applied bounds row exists for org ${args.organizationId}`,
      );
    }
    await ctx.db.patch(existing._id, {
      rejectedBoundsHash: args.rejectedBoundsHash,
      rejectedAt: Date.now(),
      rejectedBy: args.actorId,
    });
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      actorEmail: args.actorEmail,
      actorType: 'user',
      action: 'policy.retention_bounds_proposal_rejected',
      category: 'security',
      resourceType: 'governance_policy',
      resourceId: String(existing._id),
      resourceName: 'retention_bounds',
      previousState: { appliedBounds: existing.appliedBounds },
      newState: {
        rejectedBoundsHash: args.rejectedBoundsHash,
        proposedBounds: args.proposedBounds,
      },
      status: 'success',
    });
    return null;
  },
});

export const finalizePendingRetentionChange = internalMutation({
  args: {
    pendingId: v.id('retentionPolicyPendingChanges'),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.pendingId);
    if (!row || row.organizationId !== args.organizationId) return null;
    if (row.appliesAt > Date.now()) return null;
    await ctx.db.delete(args.pendingId);
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorEmail: 'system@tale.so',
      actorType: 'system',
      action: 'policy.retention_shortening_applied',
      category: 'security',
      resourceType: 'governance_policy',
      resourceId: String(args.pendingId),
      resourceName: 'retention_policy',
      newState: { summary: row.summary },
      status: 'success',
    });
    return null;
  },
});

export const deleteExpiredTwoFactorAttempt = internalMutation({
  args: { attemptId: v.id('twoFactorAttempts') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.attemptId);
    if (!row) return null;
    await ctx.db.delete(args.attemptId);
    return null;
  },
});

export const deleteExpiredCustomer = internalMutation({
  args: {
    rowId: v.id('customers'),
    organizationId: v.string(),
    cutoffMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return null;
    const guard = await assertSafeRetentionDelete(ctx, {
      rowOrganizationId: row.organizationId,
      expectedOrganizationId: args.organizationId,
      rowEffectiveMs: row._creationTime,
      cutoffMs: args.cutoffMs,
    });
    if (!guard.proceed) {
      console.info(
        `[RetentionCleanup] skipping deleteExpiredCustomer(${String(args.rowId)}): ${guard.reason}`,
      );
      return null;
    }
    await ctx.db.delete(args.rowId);
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorEmail: 'system@tale.so',
      actorType: 'system',
      action: 'customer.retention_deleted',
      category: 'data',
      resourceType: 'customer',
      resourceId: String(args.rowId),
      resourceName: row.name ?? row.email ?? 'Untitled',
      status: 'success',
    });
    return null;
  },
});

export const deleteExpiredVendor = internalMutation({
  args: {
    rowId: v.id('vendors'),
    organizationId: v.string(),
    cutoffMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return null;
    const guard = await assertSafeRetentionDelete(ctx, {
      rowOrganizationId: row.organizationId,
      expectedOrganizationId: args.organizationId,
      rowEffectiveMs: row._creationTime,
      cutoffMs: args.cutoffMs,
    });
    if (!guard.proceed) {
      console.info(
        `[RetentionCleanup] skipping deleteExpiredVendor(${String(args.rowId)}): ${guard.reason}`,
      );
      return null;
    }
    await ctx.db.delete(args.rowId);
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorEmail: 'system@tale.so',
      actorType: 'system',
      action: 'vendor.retention_deleted',
      category: 'data',
      resourceType: 'vendor',
      resourceId: String(args.rowId),
      resourceName: row.name ?? row.email ?? 'Untitled',
      status: 'success',
    });
    return null;
  },
});

export const deleteExpiredExternalConversation = internalMutation({
  args: {
    rowId: v.id('conversations'),
    organizationId: v.string(),
    cutoffMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return null;
    const guard = await assertSafeRetentionDelete(ctx, {
      rowOrganizationId: row.organizationId,
      expectedOrganizationId: args.organizationId,
      rowEffectiveMs: row._creationTime,
      cutoffMs: args.cutoffMs,
    });
    if (!guard.proceed) {
      console.info(
        `[RetentionCleanup] skipping deleteExpiredExternalConversation(${String(args.rowId)}): ${guard.reason}`,
      );
      return null;
    }
    // Cascade: drop child conversation messages first. Use the
    // by_conversationId index so we scan only the rows of interest
    // instead of every conversationMessages row in the org.
    let scanned = 0;
    const MAX_PAGE = 200;
    for await (const msg of ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId_and_deliveredAt', (q) =>
        q.eq('conversationId', args.rowId),
      )) {
      await ctx.db.delete(msg._id);
      scanned++;
      if (scanned >= MAX_PAGE) break;
    }
    if (scanned >= MAX_PAGE) {
      // More children remain; leave the conversation row in place so
      // the next pass picks it up + deletes more children before
      // finally removing the parent.
      return null;
    }
    await ctx.db.delete(args.rowId);
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorEmail: 'system@tale.so',
      actorType: 'system',
      action: 'external_conversation.retention_deleted',
      category: 'data',
      resourceType: 'conversation',
      resourceId: String(args.rowId),
      resourceName: row.subject ?? 'Untitled',
      status: 'success',
    });
    return null;
  },
});

export const deleteExpiredMessageMetadata = internalMutation({
  args: {
    rowId: v.id('messageMetadata'),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return null;

    // messageMetadata has no organizationId field today (Phase 10
    // backfill is a follow-up), so cross-org guarding goes via the
    // thread join. Mutation-layer hold re-read covers the snapshot
    // race against legal hold placement on either the org or the
    // owning user (custodian cascade). Round-2 V3 P0-8 fix: cascade
    // through the parent thread's `userId` so a custodian-held user's
    // model attribution + token telemetry survives retention.
    const holds = await loadActiveHolds(ctx, args.organizationId);
    if (holds.orgHeld) {
      console.info(
        `[RetentionCleanup] skipping deleteExpiredMessageMetadata(${String(args.rowId)}): org legal hold`,
      );
      return null;
    }
    const thread = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', row.threadId))
      .first();
    if (thread && holds.userMembershipIds.has(thread.userId)) {
      console.info(
        `[RetentionCleanup] skipping deleteExpiredMessageMetadata(${String(args.rowId)}): thread owner ${thread.userId} on custodian legal hold`,
      );
      return null;
    }

    await ctx.db.delete(args.rowId);
    return null;
  },
});

export const deleteExpiredPromptTemplate = internalMutation({
  args: {
    rowId: v.id('promptTemplates'),
    organizationId: v.string(),
    cutoffMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return null;
    const guard = await assertSafeRetentionDelete(ctx, {
      rowOrganizationId: row.organizationId,
      expectedOrganizationId: args.organizationId,
      rowEffectiveMs: row._creationTime,
      cutoffMs: args.cutoffMs,
      authorUserId: row.createdBy,
    });
    if (!guard.proceed) {
      console.info(
        `[RetentionCleanup] skipping deleteExpiredPromptTemplate(${String(args.rowId)}): ${guard.reason}`,
      );
      return null;
    }
    await ctx.db.delete(args.rowId);
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorEmail: 'system@tale.so',
      actorType: 'system',
      action: 'prompt_template.retention_deleted',
      category: 'data',
      resourceType: 'prompt_template',
      resourceId: String(args.rowId),
      resourceName: row.title ?? 'Untitled',
      status: 'success',
    });
    return null;
  },
});

export const deleteExpiredMessageFeedback = internalMutation({
  args: {
    rowId: v.id('messageFeedback'),
    organizationId: v.string(),
    cutoffMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return null;
    const guard = await assertSafeRetentionDelete(ctx, {
      rowOrganizationId: row.organizationId,
      expectedOrganizationId: args.organizationId,
      rowEffectiveMs: row._creationTime,
      cutoffMs: args.cutoffMs,
      authorUserId: row.userId,
    });
    if (!guard.proceed) {
      console.info(
        `[RetentionCleanup] skipping deleteExpiredMessageFeedback(${String(args.rowId)}): ${guard.reason}`,
      );
      return null;
    }
    await ctx.db.delete(args.rowId);
    return null;
  },
});

export const deleteExpiredMemoryAuditRow = internalMutation({
  args: {
    rowId: v.id('userMemoryAuditLog'),
    organizationId: v.string(),
    cutoffMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return null;
    // Race-safety: cascade through the row's subject user. After the
    // hold-type narrowing, only userMembership + org scope. The
    // subjectUserId is the natural author for memory-audit rows; if
    // the row also carries a threadId we read the parent thread's
    // userId as a defence-in-depth fallback (subject and thread owner
    // are usually the same user, but membership rebinding could
    // diverge during account migration).
    let authorUserId: string | undefined = row.subjectUserId;
    if (!authorUserId && row.threadId) {
      const thread = await ctx.db
        .query('threadMetadata')
        .withIndex('by_threadId', (q) => q.eq('threadId', row.threadId!))
        .first();
      authorUserId = thread?.userId;
    }
    const guard = await assertSafeRetentionDelete(ctx, {
      rowOrganizationId: row.organizationId,
      expectedOrganizationId: args.organizationId,
      rowEffectiveMs: row._creationTime,
      cutoffMs: args.cutoffMs,
      authorUserId,
    });
    if (!guard.proceed) {
      console.info(
        `[RetentionCleanup] skipping deleteExpiredMemoryAuditRow(${String(args.rowId)}): ${guard.reason}`,
      );
      return null;
    }
    await ctx.db.delete(args.rowId);
    return null;
  },
});

export const deleteExpiredChatFilterEvent = internalMutation({
  args: {
    eventId: v.id('chatFilterEvents'),
    organizationId: v.string(),
    cutoffMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.eventId);
    if (!row) {
      return null;
    }
    // chatFilterEvents have no direct authorUserId field; cascade via
    // the parent thread's `userId`. Falls back to org-only check when
    // the thread doesn't exist (deleted or legacy).
    const thread = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', row.threadId))
      .first();
    const guard = await assertSafeRetentionDelete(ctx, {
      rowOrganizationId: row.organizationId,
      expectedOrganizationId: args.organizationId,
      rowEffectiveMs: row._creationTime,
      cutoffMs: args.cutoffMs,
      authorUserId: thread?.userId,
    });
    if (!guard.proceed) {
      console.info(
        `[RetentionCleanup] skipping deleteExpiredChatFilterEvent(${String(args.eventId)}): ${guard.reason}`,
      );
      return null;
    }
    await ctx.db.delete(args.eventId);
    // No per-row audit log here — chatFilterEvents are themselves a
    // telemetry stream; retention deletions of telemetry would create
    // log spam. The cleanup run summary is sufficient.
    return null;
  },
});

export const deleteExpiredUsageLedgerRow = internalMutation({
  args: {
    rowId: v.id('usageLedger'),
    organizationId: v.string(),
    cutoffMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) {
      return null;
    }

    const guard = await assertSafeRetentionDelete(ctx, {
      rowOrganizationId: row.organizationId,
      expectedOrganizationId: args.organizationId,
      rowEffectiveMs: row._creationTime,
      cutoffMs: args.cutoffMs,
      authorUserId: row.userId,
    });
    if (!guard.proceed) {
      console.info(
        `[RetentionCleanup] skipping deleteExpiredUsageLedgerRow(${String(args.rowId)}): ${guard.reason}`,
      );
      return null;
    }

    await ctx.db.delete(args.rowId);

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorEmail: 'system@tale.so',
      actorType: 'system',
      action: 'usage_ledger.retention_deleted',
      category: 'data',
      resourceType: 'usage_ledger',
      resourceId: String(args.rowId),
      status: 'success',
    });

    return null;
  },
});

export const deleteExpiredLoginAttempt = internalMutation({
  args: {
    attemptId: v.id('loginAttempts'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) {
      return null;
    }
    await ctx.db.delete(args.attemptId);
    return null;
  },
});

export const deleteExpiredLoginBlockCounter = internalMutation({
  args: {
    counterId: v.id('loginBlockCounters'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const counter = await ctx.db.get(args.counterId);
    if (!counter) {
      return null;
    }
    await ctx.db.delete(args.counterId);
    return null;
  },
});
