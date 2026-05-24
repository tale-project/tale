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
  // SHA-256 (hex) computed by the spawner during harvest. Required at this
  // hop — spawner always emits it for new uploads (parity-guarded by
  // `HarvestOutputFile` in wire.ts). Persisted onto the `fileMetadata` row
  // so downstream readers (artifactOutputs, attestation) don't have to
  // re-fetch from the spawner result.
  sha256: v.string(),
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
        sha256: v.string(),
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
      sha256: string;
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
        sha256: f.sha256,
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
        sha256: f.sha256,
      });
    }
    return { skippedTerminal: false, insertedFiles };
  },
});
