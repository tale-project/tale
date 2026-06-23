/**
 * Snapshot a source thread's workspace files onto a freshly-forked thread.
 *
 * A FORK is a diverging copy of a conversation (`fork_own_thread` /
 * `fork_thread`), unlike a BRANCH which stays the same conversation and reads
 * its ancestors' files live (see `get_branch_ancestor_thread_ids`). So a fork
 * takes a one-time COPY of the source's files at creation and then lives its
 * own life — files the source writes afterwards must not leak in.
 *
 * Each file is copied by BYTES to a FRESH `storageId`, never by sharing the
 * source's id: `upsertThreadFile` calls `ctx.storage.delete` unconditionally on
 * replace/remove (`thread_files/internal_mutations.ts`), so a shared blob would
 * be deleted out from under whichever thread didn't trigger the delete. Copying
 * bytes needs `ctx.storage.store`, which is why this is an action (mutations
 * can't store) scheduled from the fork mutation — it is NOT a `'use node'`
 * module (the V8 runtime exposes storage; see `agent_tools/files/file_write_tool.ts`).
 *
 * Caveats:
 *   - Snapshots only the source thread's OWN files. It does not pull in the
 *     source's delegate sub-thread files (the fork starts with a fresh summary
 *     and no sub-threads; relabeling delegate files as the fork's first-party
 *     files would be wrong).
 *   - A FULL fork copies the whole current workspace as-of-fork-time. A PARTIAL
 *     fork (`fork_own_thread` with `upToMessageOrder`) passes `createdAtCutoff`,
 *     the `_creationTime` of the cutoff message; files created after the cutoff
 *     are excluded so the fork's workspace matches the messages it carried over.
 *     `threadFiles` has no message linkage, so the cut is by wall-clock
 *     `createdAt` (the same field branches slice on via `forkOrderCreatedAt`),
 *     not by message order.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import {
  THREAD_WORKSPACE_MAX_BYTES,
  THREAD_WORKSPACE_MAX_FILES,
} from '../thread_files/schema';

export const snapshotThreadFiles = internalAction({
  args: {
    sourceThreadId: v.string(),
    newThreadId: v.string(),
    organizationId: v.string(),
    userId: v.optional(v.string()),
    // Partial-fork cut: when set, only files created at or before this
    // wall-clock time are copied (see the module header). Omitted for a full
    // fork, which copies the whole current workspace.
    createdAtCutoff: v.optional(v.number()),
  },
  returns: v.object({
    copied: v.number(),
    skipped: v.number(),
    failed: v.number(),
  }),
  handler: async (ctx, args) => {
    const allRows = await ctx.runQuery(
      internal.thread_files.internal_queries.listThreadFiles,
      { threadId: args.sourceThreadId },
    );

    // Partial fork: drop files last touched after the cutoff message so the
    // fork's workspace can't inherit artifacts from a future the fork never had.
    // Cut on `updatedAt`, not `createdAt`, to match the branch cut in
    // thread_files/queries.ts: a pre-cutoff file rewritten after the cutoff
    // keeps its old `createdAt`, so a createdAt cut would copy stale-but-edited
    // content. Bind to a local so TS narrows away `undefined` in the predicate.
    const cutoff = args.createdAtCutoff;
    const rows =
      cutoff === undefined
        ? allRows
        : allRows.filter((r) => r.updatedAt <= cutoff);

    let copied = 0;
    let skipped = 0;
    let failed = 0;
    // Local budget so we don't store blobs the upsert would reject anyway; the
    // mutation re-checks authoritatively (defense in depth).
    let budgetFiles = 0;
    let budgetBytes = 0;

    for (const row of rows) {
      if (budgetFiles >= THREAD_WORKSPACE_MAX_FILES) {
        skipped++;
        continue;
      }
      if (budgetBytes + row.size > THREAD_WORKSPACE_MAX_BYTES) {
        skipped++;
        continue;
      }

      let newStorageId: Awaited<ReturnType<typeof ctx.storage.store>> | null =
        null;
      try {
        const blob = await ctx.storage.get(row.storageId);
        if (!blob) {
          // Source blob is gone (e.g. retention cleanup raced the fork). Skip
          // this file but keep snapshotting the rest.
          console.warn('[snapshotThreadFiles] source blob missing', {
            sourceThreadId: args.sourceThreadId,
            path: row.path,
          });
          failed++;
          continue;
        }
        newStorageId = await ctx.storage.store(blob);
        await ctx.runMutation(
          internal.thread_files.internal_mutations.upsertThreadFile,
          {
            organizationId: args.organizationId,
            threadId: args.newThreadId,
            path: row.path,
            storageId: newStorageId,
            size: row.size,
            contentType: row.contentType,
            // Preserve provenance verbatim: a copied user_upload is still a
            // user_upload, a copied agent_write is still an agent_write.
            source: row.source,
            ...(row.renderHint !== undefined && { renderHint: row.renderHint }),
          },
        );
        copied++;
        budgetFiles++;
        budgetBytes += row.size;
      } catch (err) {
        // Don't leak the just-stored blob if the upsert threw (e.g. an
        // authoritative quota rejection that our local budget under-counted).
        if (newStorageId) {
          try {
            await ctx.storage.delete(newStorageId);
          } catch (delErr) {
            console.warn(
              '[snapshotThreadFiles] orphan blob cleanup failed',
              delErr,
            );
          }
        }
        console.warn('[snapshotThreadFiles] per-file copy failed', {
          sourceThreadId: args.sourceThreadId,
          newThreadId: args.newThreadId,
          path: row.path,
          err,
        });
        failed++;
      }
    }

    return { copied, skipped, failed };
  },
});
