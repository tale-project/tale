import { ConvexError, v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { deleteOrgBlobInMutation } from '../lib/storage/blob_delete';
import { blobRefValidator } from '../lib/storage/blob_ref';
import {
  THREAD_FILE_MAX_BYTES,
  THREAD_WORKSPACE_MAX_BYTES,
  THREAD_WORKSPACE_MAX_FILES,
} from './schema';

export const upsertThreadFile = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    path: v.string(),
    // Blob reference (`_storage` id or `s3:` ref) — see lib/storage/blob_ref.
    storageId: blobRefValidator,
    size: v.number(),
    contentType: v.string(),
    /**
     * SHA-256 (hex) of the bytes. When provided and it matches the existing
     * row's `sha256` for the same `source`, the upsert is a no-op — the caller
     * re-harvested an unchanged file (the platform re-stages prior `run_output`
     * files into `/user/output` so scripts can read them, then the harvest
     * re-collects them). Returning `unchanged: true` lets the caller drop the
     * redundant blob and skip re-carding, killing the duplicate-file bug.
     */
    sha256: v.optional(v.string()),
    source: v.union(
      v.literal('user_upload'),
      v.literal('agent_write'),
      v.literal('run_output'),
    ),
    renderHint: v.optional(
      v.union(
        v.literal('html'),
        v.literal('svg'),
        v.literal('mermaid'),
        v.literal('markdown'),
        v.literal('code'),
        v.literal('image'),
        v.literal('attachment'),
      ),
    ),
  },
  async handler(ctx, args) {
    if (args.size > THREAD_FILE_MAX_BYTES) {
      throw new ConvexError({
        code: 'WORKSPACE_QUOTA',
        scope: 'file',
        limit: THREAD_FILE_MAX_BYTES,
        size: args.size,
        message: `File exceeds the ${THREAD_FILE_MAX_BYTES}-byte per-file cap.`,
      });
    }
    const existing = await ctx.db
      .query('threadFiles')
      .withIndex('by_thread_and_path', (q) =>
        q.eq('threadId', args.threadId).eq('path', args.path),
      )
      .first();

    // Aggregate quota check — uses the upsert delta.
    const allInThread = await ctx.db
      .query('threadFiles')
      .withIndex('by_thread_and_path', (q) => q.eq('threadId', args.threadId))
      .collect();
    const currentBytes = allInThread.reduce((sum, f) => sum + f.size, 0);
    const replacedBytes = existing?.size ?? 0;
    const projectedBytes = currentBytes - replacedBytes + args.size;
    if (projectedBytes > THREAD_WORKSPACE_MAX_BYTES) {
      throw new ConvexError({
        code: 'WORKSPACE_QUOTA',
        scope: 'workspace_bytes',
        limit: THREAD_WORKSPACE_MAX_BYTES,
        current: currentBytes,
        message: `Workspace would exceed the ${THREAD_WORKSPACE_MAX_BYTES}-byte cap.`,
      });
    }
    if (existing === null && allInThread.length >= THREAD_WORKSPACE_MAX_FILES) {
      throw new ConvexError({
        code: 'WORKSPACE_QUOTA',
        scope: 'workspace_files',
        limit: THREAD_WORKSPACE_MAX_FILES,
        current: allInThread.length,
        message: `Workspace already holds ${THREAD_WORKSPACE_MAX_FILES} files. Delete some before adding more.`,
      });
    }

    const now = Date.now();
    if (existing !== null) {
      // Unchanged re-harvest: same bytes, same source → no-op. Keep the
      // existing row + blob untouched; the caller drops the redundant new
      // blob it just uploaded and skips re-carding.
      if (
        args.sha256 !== undefined &&
        existing.sha256 === args.sha256 &&
        existing.source === args.source
      ) {
        return { id: existing._id, replaced: false, unchanged: true };
      }
      // Replace — drop the old blob to avoid leak. Backend-aware: an `s3:`
      // ref routes through the scheduled node lane (a mutation can't sign S3).
      await deleteOrgBlobInMutation(
        ctx,
        existing.organizationId,
        existing.storageId,
        'threadFiles.upsert.replace',
      );
      const patch: Record<string, unknown> = {
        storageId: args.storageId,
        size: args.size,
        contentType: args.contentType,
        source: args.source,
        updatedAt: now,
      };
      if (args.sha256 !== undefined) patch.sha256 = args.sha256;
      if (args.renderHint !== undefined) patch.renderHint = args.renderHint;
      await ctx.db.patch(existing._id, patch);
      return { id: existing._id, replaced: true, unchanged: false };
    }

    const id = await ctx.db.insert('threadFiles', {
      organizationId: args.organizationId,
      threadId: args.threadId,
      path: args.path,
      storageId: args.storageId,
      size: args.size,
      contentType: args.contentType,
      source: args.source,
      ...(args.sha256 !== undefined && { sha256: args.sha256 }),
      ...(args.renderHint !== undefined && { renderHint: args.renderHint }),
      createdAt: now,
      updatedAt: now,
    });
    return { id, replaced: false, unchanged: false };
  },
});

export const deleteThreadFile = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    path: v.string(),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query('threadFiles')
      .withIndex('by_thread_and_path', (q) =>
        q.eq('threadId', args.threadId).eq('path', args.path),
      )
      .first();
    if (existing === null) return { deleted: false };
    if (existing.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: 'CROSS_ORG_ACCESS',
        message: 'Thread file does not belong to this organization.',
      });
    }
    // Backend-aware: an `s3:` ref routes through the scheduled node lane.
    await deleteOrgBlobInMutation(
      ctx,
      existing.organizationId,
      existing.storageId,
      'threadFiles.delete',
    );
    await ctx.db.delete(existing._id);
    return { deleted: true };
  },
});
