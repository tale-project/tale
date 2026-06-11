import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { createApproval } from '../approvals/helpers';
import type { KnowledgeWriteMetadata } from '../approvals/types';
import { createDocument } from '../documents/create_document';
import { getOrCreateFolderPath } from '../folders/get_or_create_path';
import { checkOrganizationRateLimit } from '../lib/rate_limiter/helpers';
import {
  KNOWLEDGE_ENTRIES_FOLDER,
  KNOWLEDGE_SOURCE_PROVIDER,
} from './constants';
import {
  findActiveEntryByTopicKey,
  upsertEntryRow,
  validateTopicAndContent,
  type UpsertEntryResult,
} from './helpers';

export const createKnowledgeWriteApproval = internalMutation({
  args: {
    organizationId: v.string(),
    topic: v.string(),
    content: v.string(),
    incorrectInfo: v.optional(v.string()),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  returns: v.object({
    approvalId: v.id('approvals'),
    replacesTopic: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    await checkOrganizationRateLimit(
      ctx,
      'knowledge:write',
      args.organizationId,
    );

    const { topic, topicKey, content } = validateTopicAndContent(
      args.topic,
      args.content,
    );

    const existing = await findActiveEntryByTopicKey(
      ctx,
      args.organizationId,
      topicKey,
    );

    const metadata: KnowledgeWriteMetadata = {
      topic,
      topicKey,
      content,
      incorrectInfo: args.incorrectInfo,
      replacesEntryId: existing ? String(existing._id) : undefined,
      replacesTopic: existing?.topic,
      requestedAt: Date.now(),
    };

    const approvalId = await createApproval(ctx, {
      organizationId: args.organizationId,
      resourceType: 'knowledge_write',
      resourceId: `knowledge_write:${topicKey}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      priority: 'medium',
      description: existing
        ? `Update knowledge entry: ${topic}`
        : `Add knowledge entry: ${topic}`,
      threadId: args.threadId,
      messageId: args.messageId,
      metadata,
    });

    return {
      approvalId,
      replacesTopic: existing?.topic ?? null,
    };
  },
});

export const claimKnowledgeWriteForExecution = internalMutation({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) throw new Error('Approval not found');
    if (approval.executedAt) return false;
    await ctx.db.patch(args.approvalId, { executedAt: Date.now() });
    return true;
  },
});

export const applyKnowledgeWrite = internalMutation({
  args: {
    organizationId: v.string(),
    topic: v.string(),
    content: v.string(),
    source: v.union(v.literal('chat'), v.literal('manual')),
    createdBy: v.string(),
    sourceThreadId: v.optional(v.string()),
    sourceMessageId: v.optional(v.string()),
  },
  returns: v.object({
    entryId: v.id('knowledgeEntries'),
    documentId: v.union(v.id('documents'), v.null()),
    replacedEntryId: v.union(v.id('knowledgeEntries'), v.null()),
  }),
  handler: async (ctx, args): Promise<UpsertEntryResult> => {
    const { topic, topicKey, content } = validateTopicAndContent(
      args.topic,
      args.content,
    );
    return await upsertEntryRow(ctx, {
      organizationId: args.organizationId,
      topic,
      topicKey,
      content,
      source: args.source,
      createdBy: args.createdBy,
      sourceThreadId: args.sourceThreadId,
      sourceMessageId: args.sourceMessageId,
    });
  },
});

export const updateKnowledgeWriteApprovalWithResult = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    entryId: v.union(v.id('knowledgeEntries'), v.null()),
    documentId: v.union(v.id('documents'), v.null()),
    executionError: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) throw new Error('Approval not found');
    if (approval.resourceType !== 'knowledge_write') {
      throw new Error('Approval is not a knowledge_write approval');
    }

    const now = Date.now();
    const metadata = approval.metadata || {};

    await ctx.db.patch(args.approvalId, {
      status: args.executionError ? 'rejected' : 'completed',
      executedAt: now,
      executionError: args.executionError ?? undefined,
      metadata: {
        ...metadata,
        executedAt: now,
        ...(args.entryId ? { entryId: String(args.entryId) } : {}),
        ...(args.documentId ? { documentId: String(args.documentId) } : {}),
        ...(args.executionError ? { executionError: args.executionError } : {}),
      },
    });
    return null;
  },
});

/**
 * Create or replace the markdown backing document for an entry after its
 * content blob has been stored. Called from `materializeKnowledgeEntry`.
 *
 * - Existing backing document → patch title/file and schedule
 *   `reindexDocumentInRag` (upload-then-delete; tolerant of a never-indexed
 *   old blob).
 * - No backing document → create one in the reserved "Knowledge entries"
 *   folder (`sourceProvider: 'knowledge'`) and schedule `uploadDocumentToRag`.
 */
export const attachEntryDocument = internalMutation({
  args: {
    entryId: v.id('knowledgeEntries'),
    fileId: v.id('_storage'),
    contentHash: v.string(),
  },
  returns: v.union(v.id('documents'), v.null()),
  handler: async (ctx, args): Promise<Id<'documents'> | null> => {
    const entry = await ctx.db.get(args.entryId);
    // Entry deleted or superseded while the blob was being stored — a newer
    // version (or nothing) owns the backing document now.
    if (!entry || entry.deletedAt !== undefined || entry.status !== 'active') {
      return null;
    }

    const title = `${entry.topic}.md`;
    const existingDoc = entry.documentId
      ? await ctx.db.get(entry.documentId)
      : null;

    if (existingDoc) {
      const oldFileId = existingDoc.fileId;
      await ctx.db.patch(existingDoc._id, {
        title,
        fileId: args.fileId,
        mimeType: 'text/markdown',
        extension: 'md',
        contentHash: args.contentHash,
        ...(oldFileId
          ? { historyFiles: [...(existingDoc.historyFiles ?? []), oldFileId] }
          : {}),
      });
      await linkFileMetadataToDocument(ctx, args.fileId, existingDoc._id);

      if (oldFileId) {
        await ctx.scheduler.runAfter(
          0,
          internal.documents.internal_actions.reindexDocumentInRag,
          {
            documentId: existingDoc._id,
            oldFileId,
            oldOrganizationId: existingDoc.organizationId,
          },
        );
      } else {
        await ctx.scheduler.runAfter(
          0,
          internal.documents.internal_actions.uploadDocumentToRag,
          { documentId: existingDoc._id },
        );
      }
      return existingDoc._id;
    }

    const folderId = await getOrCreateFolderPath(
      ctx,
      entry.organizationId,
      [KNOWLEDGE_ENTRIES_FOLDER],
      entry.createdBy,
    );

    const { documentId } = await createDocument(ctx, {
      organizationId: entry.organizationId,
      title,
      fileId: args.fileId,
      mimeType: 'text/markdown',
      extension: 'md',
      contentHash: args.contentHash,
      sourceProvider: KNOWLEDGE_SOURCE_PROVIDER,
      createdBy: entry.createdBy,
      folderId,
    });

    await linkFileMetadataToDocument(ctx, args.fileId, documentId);
    await ctx.db.patch(args.entryId, { documentId });

    await ctx.scheduler.runAfter(
      0,
      internal.documents.internal_actions.uploadDocumentToRag,
      { documentId },
    );
    return documentId;
  },
});

async function linkFileMetadataToDocument(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
  documentId: Id<'documents'>,
): Promise<void> {
  const metadata = await ctx.db
    .query('fileMetadata')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .first();
  if (!metadata) {
    console.warn(
      `[attachEntryDocument] No fileMetadata for storageId ${storageId}; skipping document link`,
    );
    return;
  }
  await ctx.db.patch(metadata._id, { documentId });
}
