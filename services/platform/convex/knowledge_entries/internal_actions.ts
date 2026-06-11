'use node';

import { createHash } from 'node:crypto';

import { v, type Infer } from 'convex/values';

import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction, type ActionCtx } from '../_generated/server';
import type { KnowledgeWriteMetadata } from '../approvals/types';

type JsonValue = Infer<typeof jsonValueValidator>;

interface MaterializeResult {
  documentId: Id<'documents'> | null;
}

/**
 * Store the entry's markdown content as a `_storage` blob and create/replace
 * its backing document (which schedules the RAG upload/re-index). The entry
 * row is the source of truth for the UI; this materialization only feeds the
 * retrieval pipeline, so a failure here leaves the entry visible with its
 * indexing status reported as failed/not indexed.
 */
async function materializeEntry(
  ctx: ActionCtx,
  entryId: Id<'knowledgeEntries'>,
): Promise<MaterializeResult> {
  const entry = await ctx.runQuery(
    internal.knowledge_entries.internal_queries.getEntryById,
    { entryId },
  );
  if (!entry || entry.deletedAt !== undefined || entry.status !== 'active') {
    return { documentId: null };
  }

  const stored = await ctx.runAction(
    internal.documents.internal_actions.storeRawContent,
    {
      organizationId: entry.organizationId,
      fileName: `${entry.topic}.md`,
      content: entry.content,
      contentType: 'text/markdown',
      extension: 'md',
    },
  );

  const contentHash = createHash('sha256').update(entry.content).digest('hex');

  const documentId = await ctx.runMutation(
    internal.knowledge_entries.internal_mutations.attachEntryDocument,
    {
      entryId,
      fileId: stored.fileStorageId,
      contentHash,
    },
  );

  return { documentId };
}

export const materializeKnowledgeEntry = internalAction({
  args: {
    entryId: v.id('knowledgeEntries'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    try {
      await materializeEntry(ctx, args.entryId);
    } catch (error) {
      console.error(
        `[materializeKnowledgeEntry] Failed to materialize entry ${args.entryId}:`,
        error,
      );
      throw error;
    }
    return null;
  },
});

export const executeApprovedKnowledgeWrite = internalAction({
  args: {
    approvalId: v.id('approvals'),
    approvedBy: v.string(),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const approval = await ctx.runQuery(
      internal.approvals.internal_queries.getApprovalById,
      { approvalId: args.approvalId },
    );

    if (!approval) {
      throw new Error('Approval not found');
    }
    if (approval.status !== 'executing') {
      throw new Error(
        `Cannot execute knowledge write: approval status is "${approval.status}", expected "executing"`,
      );
    }
    if (approval.resourceType !== 'knowledge_write') {
      throw new Error(
        `Invalid approval type: expected "knowledge_write", got "${approval.resourceType}"`,
      );
    }
    if (approval.executedAt) {
      throw new Error(
        'This knowledge write approval has already been executed',
      );
    }

    const claimed = await ctx.runMutation(
      internal.knowledge_entries.internal_mutations
        .claimKnowledgeWriteForExecution,
      { approvalId: args.approvalId },
    );
    if (!claimed) {
      throw new Error(
        'This knowledge write approval has already been executed',
      );
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is v.any() but always matches KnowledgeWriteMetadata for knowledge_write approvals
    const metadata = (approval.metadata ?? {}) as KnowledgeWriteMetadata;
    if (!metadata.topic || !metadata.content) {
      throw new Error('Invalid approval metadata: missing topic or content');
    }

    try {
      const applied = await ctx.runMutation(
        internal.knowledge_entries.internal_mutations.applyKnowledgeWrite,
        {
          organizationId: approval.organizationId,
          topic: metadata.topic,
          content: metadata.content,
          source: 'chat',
          createdBy: args.approvedBy,
          sourceThreadId: approval.threadId,
          sourceMessageId: approval.messageId,
        },
      );

      const { documentId } = await materializeEntry(ctx, applied.entryId);

      await ctx.runMutation(
        internal.knowledge_entries.internal_mutations
          .updateKnowledgeWriteApprovalWithResult,
        {
          approvalId: args.approvalId,
          entryId: applied.entryId,
          documentId,
          executionError: null,
        },
      );

      return {
        success: true,
        entryId: String(applied.entryId),
        documentId: documentId ? String(documentId) : null,
        replacedEntryId: applied.replacedEntryId
          ? String(applied.replacedEntryId)
          : null,
        topic: metadata.topic,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[executeApprovedKnowledgeWrite] Failed for approval ${args.approvalId}: ${message}`,
      );
      await ctx.runMutation(
        internal.knowledge_entries.internal_mutations
          .updateKnowledgeWriteApprovalWithResult,
        {
          approvalId: args.approvalId,
          entryId: null,
          documentId: null,
          executionError: message,
        },
      );
      return {
        success: false,
        error: message,
        topic: metadata.topic,
      };
    }
  },
});
