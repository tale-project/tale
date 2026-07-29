'use node';

import { createHash } from 'node:crypto';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction, type ActionCtx } from '../_generated/server';

interface MaterializeResult {
  documentId: Id<'documents'> | null;
}

/**
 * Store the entry's markdown content as a `_storage` blob and create/replace
 * its backing document. The entry row is the source of truth for the UI; this
 * materialization only feeds the retrieval pipeline (currently offline — the
 * scheduled upload/reindex actions log and no-op until the RAG ingest seam
 * reconnects, exactly like uploaded documents), so a failure here leaves the
 * entry visible with its indexing status reported as not indexed.
 *
 * The chat-era `executeApprovedKnowledgeWrite` retired with the old approvals
 * flow; it returns with the approve-first `knowledge_write` capability.
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
