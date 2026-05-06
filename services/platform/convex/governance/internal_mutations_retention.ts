import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { deleteStorageWithMetadata } from '../file_metadata/helpers';
import { cascadeDeleteThreadChildren } from '../threads/cascade_helpers';

export const deleteExpiredDocument = internalMutation({
  args: {
    documentId: v.id('documents'),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) {
      return null;
    }

    if (doc.fileId) {
      const fileId = doc.fileId;
      await ctx.storage.delete(fileId);

      const metadata = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
        .first();
      if (metadata) {
        await ctx.db.delete(metadata._id);
      }
    }

    if (doc.historyFiles) {
      for (const historyFileId of doc.historyFiles) {
        await ctx.storage.delete(historyFileId);

        const histMeta = await ctx.db
          .query('fileMetadata')
          .withIndex('by_storageId', (q) => q.eq('storageId', historyFileId))
          .first();
        if (histMeta) {
          await ctx.db.delete(histMeta._id);
        }
      }
    }

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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const metadata = await ctx.db.get(args.fileMetadataId);
    if (!metadata) {
      return null;
    }

    await deleteStorageWithMetadata(ctx, metadata.storageId);
    return null;
  },
});

export const deleteExpiredThread = internalMutation({
  args: {
    threadMetadataId: v.id('threadMetadata'),
    organizationId: v.string(),
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

    // Use the shared cascade helper so user-delete and retention-delete
    // can never drift on which descendant tables get cleaned up.
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (!execution) {
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const log = await ctx.db.get(args.triggerLogId);
    if (!log) {
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return null;
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return null;
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return null;
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return null;
    await ctx.db.delete(args.rowId);
    return null;
  },
});

export const deleteExpiredPromptTemplate = internalMutation({
  args: {
    rowId: v.id('promptTemplates'),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return null;
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return null;
    await ctx.db.delete(args.rowId);
    return null;
  },
});

export const deleteExpiredMemoryAuditRow = internalMutation({
  args: {
    rowId: v.id('userMemoryAuditLog'),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return null;
    await ctx.db.delete(args.rowId);
    return null;
  },
});

export const deleteExpiredChatFilterEvent = internalMutation({
  args: {
    eventId: v.id('chatFilterEvents'),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.eventId);
    if (!row) {
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) {
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
