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
