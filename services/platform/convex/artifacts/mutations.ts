import { v } from 'convex/values';
import { ConvexError } from 'convex/values';

import { mutation } from '../_generated/server';
import { validatePath } from '../agent_tools/artifacts/shared';
import { getAuthUserIdentity } from '../lib/rls';
import { assertThreadAccess } from '../lib/rls/auth/can_access_thread';
import { assertAggregateSize } from './internal_mutations';
import { mirrorLegacyContent, resolveArtifactFiles } from './resolve_files';

/**
 * User-driven edit from the Canvas pane. Path-aware: writes to a specific
 * file in the project. Refuses to overwrite the file currently being
 * streamed-to by the LLM, but allows concurrent edits to OTHER files.
 */
export const userEdit = mutation({
  args: {
    artifactId: v.id('artifacts'),
    /** File path within the artifact. Defaults to the row's `entryFile`. */
    path: v.optional(v.string()),
    content: v.string(),
  },
  returns: v.object({ revision: v.number(), path: v.string() }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Artifact not found.',
      });
    }
    const metadata = await assertThreadAccess(ctx, artifact.threadId, authUser);
    if (metadata.organizationId !== artifact.organizationId) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Not authorized to access this thread.',
      });
    }

    const resolved = resolveArtifactFiles(artifact);
    const targetPath =
      args.path !== undefined ? validatePath(args.path) : resolved.entryFile;

    // Refuse iff the LLM is streaming to THIS specific file. Edits to other
    // files in the same project are allowed concurrently (per R2-07).
    if (
      artifact.liveStreamMode !== undefined &&
      artifact.streamingPath === targetPath
    ) {
      throw new ConvexError({
        code: 'streaming',
        message: `Cannot edit "${targetPath}" while the agent is streaming to it.`,
      });
    }

    // Find existing or treat as new file.
    const existing = resolved.files.find((f) => f.path === targetPath);
    if (existing && existing.content === args.content) {
      return { revision: artifact.revision, path: targetPath };
    }

    const nextFiles = existing
      ? resolved.files.map((f) =>
          f.path === targetPath
            ? { path: targetPath, content: args.content }
            : f,
        )
      : [...resolved.files, { path: targetPath, content: args.content }];

    assertAggregateSize(nextFiles);

    const nextRevision = artifact.revision + 1;
    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      files: nextFiles,
      entryFile: resolved.entryFile,
      content: mirrorLegacyContent(nextFiles, resolved.entryFile),
      revision: nextRevision,
      lastEditedByMessageId: undefined,
      updatedAt: now,
    });
    await ctx.db.insert('artifactRevisions', {
      artifactId: args.artifactId,
      revision: nextRevision,
      content: mirrorLegacyContent(nextFiles, resolved.entryFile),
      files: nextFiles,
      entryFile: resolved.entryFile,
      filePath: targetPath,
      editedByMessageId: undefined,
      editKind: 'user',
      createdAt: now,
    });
    return { revision: nextRevision, path: targetPath };
  },
});
