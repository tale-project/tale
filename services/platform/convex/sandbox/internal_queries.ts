// Internal queries the sandbox Node action uses to resolve input file refs
// and verify org+thread scoping (closes the IDOR vector R2.8 flagged for
// `inputFiles`).

import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';

/**
 * Resolve a list of caller-supplied `fileId` strings (intended to be
 * `Id<'fileMetadata'>`) into their `storageId`s. Refuses any row that
 * doesn't belong to the caller's organization, or any chat-bound row
 * whose `threadId` isn't in the caller's accessible-thread set.
 *
 * The Node action calls this BEFORE staging anything into the sandbox.
 */
export const resolveInputFiles = internalQuery({
  args: {
    organizationId: v.string(),
    accessibleThreadIds: v.array(v.string()),
    fileIds: v.array(v.string()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      files: v.array(
        v.object({
          fileId: v.string(),
          storageId: v.id('_storage'),
          contentType: v.string(),
          size: v.number(),
          fileName: v.string(),
        }),
      ),
    }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const allowedThreads = new Set(args.accessibleThreadIds);
    const out: {
      fileId: string;
      storageId: Id<'_storage'>;
      contentType: string;
      size: number;
      fileName: string;
    }[] = [];
    for (const fileIdStr of args.fileIds) {
      const fileId = ctx.db.normalizeId('fileMetadata', fileIdStr);
      if (!fileId) {
        return { ok: false as const, reason: `Invalid fileId: ${fileIdStr}` };
      }
      const row = await ctx.db.get(fileId);
      if (!row) {
        return { ok: false as const, reason: `Unknown fileId: ${fileIdStr}` };
      }
      if (row.organizationId !== args.organizationId) {
        return {
          ok: false as const,
          reason: `fileId ${fileIdStr} belongs to a different organization`,
        };
      }
      if (row.threadId !== undefined && !allowedThreads.has(row.threadId)) {
        return {
          ok: false as const,
          reason: `fileId ${fileIdStr} is bound to a thread outside this caller's scope`,
        };
      }
      out.push({
        fileId: fileIdStr,
        storageId: row.storageId,
        contentType: row.contentType,
        size: row.size,
        fileName: row.fileName,
      });
    }
    return { ok: true as const, files: out };
  },
});
