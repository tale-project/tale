// Internal mutations the sandbox Node action uses to commit storage uploads
// transactionally. Kept in the non-`use node` module because mutations don't
// run in the Node runtime.

import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';
import { sandboxTerminalStatuses } from './wire';

const outputFileValidator = v.object({
  name: v.string(),
  storageId: v.id('_storage'),
  size: v.number(),
  contentType: v.string(),
});

/**
 * After the action has uploaded every output blob to `_storage`, this
 * mutation atomically inserts the `fileMetadata` rows that point at them.
 * All-or-nothing: if any insert fails the mutation aborts and the caller
 * deletes the orphaned `_storage` blobs.
 *
 * Terminal-state guard mirrors `finalize`'s posture (audit follow-up F6):
 * if the audit row reached a terminal state between the spawner's SSE
 * `result` event and this mutation (e.g. the user clicked Stop right
 * before the harvest landed), we return `{skippedTerminal: true}` so the
 * caller skips the `uploadedStorageIds.clear()` step and the
 * `failExecution`-style rollback can delete the orphan blobs.
 */
export const insertOutputFiles = internalMutation({
  args: {
    executionId: v.id('sandboxExecutions'),
    organizationId: v.string(),
    threadId: v.optional(v.string()),
    uploadedBy: v.string(),
    files: v.array(outputFileValidator),
  },
  returns: v.object({
    skippedTerminal: v.boolean(),
    insertedFiles: v.array(
      v.object({
        name: v.string(),
        fileMetadataId: v.id('fileMetadata'),
        storageId: v.id('_storage'),
        size: v.number(),
        contentType: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.executionId);
    if (row !== null && sandboxTerminalStatuses.has(row.status)) {
      console.warn(
        `[sandbox.insertOutputFiles] no-op: row ${row._id} already terminal as ${row.status}; caller must roll back ${args.files.length} blob(s)`,
      );
      return { skippedTerminal: true, insertedFiles: [] };
    }
    const now = Date.now();
    const insertedFiles: {
      name: string;
      fileMetadataId: Id<'fileMetadata'>;
      storageId: Id<'_storage'>;
      size: number;
      contentType: string;
    }[] = [];
    for (const f of args.files) {
      const fileMetadataId = await ctx.db.insert('fileMetadata', {
        organizationId: args.organizationId,
        storageId: f.storageId,
        ...(args.threadId !== undefined && { threadId: args.threadId }),
        uploadedBy: args.uploadedBy,
        fileName: f.name,
        contentType: f.contentType,
        size: f.size,
        source: 'agent',
        lifecycleStatus: 'active',
        statusChangedAt: now,
      });
      insertedFiles.push({
        name: f.name,
        fileMetadataId,
        storageId: f.storageId,
        size: f.size,
        contentType: f.contentType,
      });
    }
    return { skippedTerminal: false, insertedFiles };
  },
});
