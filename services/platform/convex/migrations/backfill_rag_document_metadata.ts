/**
 * Migration: Sync filterable document metadata to the RAG service.
 *
 * RAG stores a flat `documents.metadata` JSONB bag used by the metadata
 * pre-filter on /search (#1517). Documents indexed before that column
 * existed carry `{}` on the RAG side and would never match metadata-
 * filtered searches. This sweep pushes the platform's canonical
 * team_id / source_provider / extension for every active file-backed
 * document through the batch `PATCH /api/v1/documents/metadata`
 * endpoint — no re-extraction or re-embedding. Files that were never
 * indexed simply update zero RAG rows.
 *
 * Idempotent: re-running re-sends the same values.
 *
 * Usage:
 *   bunx convex run migrations/backfill_rag_document_metadata:backfillRagDocumentMetadata
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction, internalQuery } from '../_generated/server';

const BATCH_SIZE = 200;

type MetadataDocPage = {
  continueCursor: string;
  isDone: boolean;
  docs: Array<{
    organizationId: string;
    fileId: Id<'_storage'>;
    metadata: Record<string, string>;
  }>;
};

export const listMetadataDocsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<MetadataDocPage> => {
    const result = await ctx.db
      .query('documents')
      .paginate({ cursor: args.cursor, numItems: BATCH_SIZE });

    return {
      continueCursor: result.continueCursor,
      isDone: result.isDone,
      docs: result.page.flatMap((doc) => {
        if ((doc.lifecycleStatus ?? 'active') !== 'active') return [];
        if (!doc.fileId) return [];
        const metadata: Record<string, string> = {};
        if (doc.teamId) metadata.team_id = doc.teamId;
        if (doc.sourceProvider) metadata.source_provider = doc.sourceProvider;
        if (doc.extension) metadata.extension = doc.extension;
        if (Object.keys(metadata).length === 0) return [];
        return [
          {
            organizationId: doc.organizationId,
            fileId: doc.fileId,
            metadata,
          },
        ];
      }),
    };
  },
});

export const backfillRagDocumentMetadata = internalAction({
  args: {},
  returns: v.object({ synced: v.number() }),
  handler: async (ctx): Promise<{ synced: number }> => {
    let cursor: string | null = null;
    let isDone = false;
    let synced = 0;

    while (!isDone) {
      const page: MetadataDocPage = await ctx.runQuery(
        internal.migrations.backfill_rag_document_metadata.listMetadataDocsPage,
        { cursor },
      );

      const byOrg = new Map<
        string,
        Array<{ fileId: Id<'_storage'>; metadata: Record<string, string> }>
      >();
      for (const doc of page.docs) {
        const updates = byOrg.get(doc.organizationId) ?? [];
        updates.push({ fileId: doc.fileId, metadata: doc.metadata });
        byOrg.set(doc.organizationId, updates);
      }

      for (const [organizationId, updates] of byOrg) {
        await ctx.runAction(
          internal.documents.internal_actions.syncRagDocumentMetadata,
          { organizationId, updates },
        );
        synced += updates.length;
      }

      cursor = page.continueCursor;
      isDone = page.isDone;
    }

    console.log(
      `[backfillRagDocumentMetadata] Synced metadata for ${synced} document(s)`,
    );
    return { synced };
  },
});
