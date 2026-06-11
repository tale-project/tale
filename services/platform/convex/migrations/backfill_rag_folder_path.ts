/**
 * Migration: Sync Document Hub folder paths to the RAG service.
 *
 * RAG stores a denormalized `documents.folder_path` used by the
 * folder-scoped search filter. Documents indexed before that column
 * existed carry NULL folder_path on the RAG side and would never match
 * folder-filtered searches. This sweep pushes the platform's canonical
 * `documents.folderPath` for every active file-backed document through
 * the batch `PATCH /api/v1/documents/folder-paths` endpoint — no
 * re-extraction or re-embedding. Files that were never indexed simply
 * update zero RAG rows.
 *
 * Idempotent: re-running re-sends the same values.
 *
 * Usage:
 *   bunx convex run migrations/backfill_rag_folder_path:backfillRagFolderPath
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction, internalQuery } from '../_generated/server';

const BATCH_SIZE = 200;

type FolderDocPage = {
  continueCursor: string;
  isDone: boolean;
  docs: Array<{
    organizationId: string;
    fileId: Id<'_storage'>;
    folderPath: string;
  }>;
};

export const listFolderDocsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<FolderDocPage> => {
    const result = await ctx.db
      .query('documents')
      .paginate({ cursor: args.cursor, numItems: BATCH_SIZE });

    return {
      continueCursor: result.continueCursor,
      isDone: result.isDone,
      docs: result.page.flatMap((doc) => {
        if ((doc.lifecycleStatus ?? 'active') !== 'active') return [];
        if (!doc.fileId || !doc.folderPath) return [];
        return [
          {
            organizationId: doc.organizationId,
            fileId: doc.fileId,
            folderPath: doc.folderPath,
          },
        ];
      }),
    };
  },
});

export const backfillRagFolderPath = internalAction({
  args: {},
  returns: v.object({ synced: v.number() }),
  handler: async (ctx): Promise<{ synced: number }> => {
    let cursor: string | null = null;
    let isDone = false;
    let synced = 0;

    while (!isDone) {
      const page: FolderDocPage = await ctx.runQuery(
        internal.migrations.backfill_rag_folder_path.listFolderDocsPage,
        { cursor },
      );

      const byOrg = new Map<
        string,
        Array<{ fileId: Id<'_storage'>; folderPath: string }>
      >();
      for (const doc of page.docs) {
        const updates = byOrg.get(doc.organizationId) ?? [];
        updates.push({ fileId: doc.fileId, folderPath: doc.folderPath });
        byOrg.set(doc.organizationId, updates);
      }

      for (const [organizationId, updates] of byOrg) {
        await ctx.runAction(
          internal.documents.internal_actions.syncRagFolderPaths,
          { organizationId, updates },
        );
        synced += updates.length;
      }

      cursor = page.continueCursor;
      isDone = page.isDone;
    }

    console.log(
      `[backfillRagFolderPath] Synced folder paths for ${synced} document(s)`,
    );
    return { synced };
  },
});
