import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { applyPatches } from '../agent_tools/artifacts/apply_patches';
import {
  artifactPatchValidator,
  artifactTypeValidator,
  liveStreamModeValidator,
} from './schema';

const STALE_STREAM_THRESHOLD_MS = 60_000;

/**
 * Insert a new artifact (revision 1) and its initial revision row. Used by
 * the `artifact_create` tool both at the streaming-placeholder moment and
 * at the final settle. When `liveStreamMode` is provided, the row is
 * marked as actively-streaming.
 */
export const createArtifact = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    type: artifactTypeValidator,
    title: v.string(),
    language: v.optional(v.string()),
    content: v.string(),
    createdByMessageId: v.string(),
    liveStreamMode: v.optional(liveStreamModeValidator),
  },
  returns: v.object({ artifactId: v.id('artifacts'), revision: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const isStreaming = args.liveStreamMode !== undefined;
    const artifactId = await ctx.db.insert('artifacts', {
      organizationId: args.organizationId,
      threadId: args.threadId,
      type: args.type,
      title: args.title,
      language: args.language,
      content: isStreaming ? '' : args.content,
      revision: 1,
      createdByMessageId: args.createdByMessageId,
      lastEditedByMessageId: args.createdByMessageId,
      createdAt: now,
      updatedAt: now,
      liveStreamMode: args.liveStreamMode,
      liveStreamStartedAt: isStreaming ? now : undefined,
      streamingContent: isStreaming ? args.content : undefined,
    });
    if (!isStreaming) {
      await ctx.db.insert('artifactRevisions', {
        artifactId,
        revision: 1,
        content: args.content,
        editedByMessageId: args.createdByMessageId,
        editKind: 'create',
        createdAt: now,
      });
    }
    return { artifactId, revision: 1 };
  },
});

/**
 * Settle the streaming-placeholder row inserted by `createArtifact`:
 * move `streamingContent` into `content`, write the initial revision
 * row, and clear streaming flags.
 */
export const finalizeStreamedCreate = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    content: v.string(),
    editedByMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      content: args.content,
      streamingContent: undefined,
      liveStreamMode: undefined,
      liveStreamStartedAt: undefined,
      updatedAt: now,
    });
    await ctx.db.insert('artifactRevisions', {
      artifactId: args.artifactId,
      revision: 1,
      content: args.content,
      editedByMessageId: args.editedByMessageId,
      editKind: 'create',
      createdAt: now,
    });
    return null;
  },
});

export const applyToolPatches = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    patches: v.array(artifactPatchValidator),
    editedByMessageId: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      revision: v.number(),
      content: v.string(),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
      failedIndex: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact) {
      return {
        success: false as const,
        error: `artifact ${args.artifactId} not found`,
        failedIndex: 0,
      };
    }
    const result = applyPatches(artifact.content, args.patches);
    if (!result.ok) {
      return {
        success: false as const,
        error: result.error,
        failedIndex: result.failedIndex,
      };
    }
    const nextRevision = artifact.revision + 1;
    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      content: result.content,
      revision: nextRevision,
      lastEditedByMessageId: args.editedByMessageId,
      streamingContent: undefined,
      liveStreamMode: undefined,
      liveStreamStartedAt: undefined,
      updatedAt: now,
    });
    await ctx.db.insert('artifactRevisions', {
      artifactId: args.artifactId,
      revision: nextRevision,
      content: result.content,
      editedByMessageId: args.editedByMessageId,
      editKind: 'patch',
      patches: [...args.patches],
      createdAt: now,
    });
    return {
      success: true as const,
      revision: nextRevision,
      content: result.content,
    };
  },
});

export const rewriteArtifact = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    content: v.string(),
    editedByMessageId: v.string(),
  },
  returns: v.object({ revision: v.number() }),
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact) {
      throw new Error(`artifact ${args.artifactId} not found`);
    }
    const nextRevision = artifact.revision + 1;
    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      content: args.content,
      revision: nextRevision,
      lastEditedByMessageId: args.editedByMessageId,
      streamingContent: undefined,
      liveStreamMode: undefined,
      liveStreamStartedAt: undefined,
      updatedAt: now,
    });
    await ctx.db.insert('artifactRevisions', {
      artifactId: args.artifactId,
      revision: nextRevision,
      content: args.content,
      editedByMessageId: args.editedByMessageId,
      editKind: 'rewrite',
      createdAt: now,
    });
    return { revision: nextRevision };
  },
});

/**
 * Mark an existing artifact as actively streaming. Used by `artifact_edit`
 * once the tool input has parsed enough JSON to identify the target.
 */
export const beginEditStream = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    liveStreamMode: liveStreamModeValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.artifactId, {
      liveStreamMode: args.liveStreamMode,
      liveStreamStartedAt: Date.now(),
      streamingContent: args.liveStreamMode === 'rewrite' ? '' : undefined,
    });
    return null;
  },
});

/**
 * Throttled-by-the-caller update of the partial content as the LLM streams
 * its tool-call argument. Writes to the shadow `streamingContent` field so
 * a mid-stream crash cannot corrupt the previously-settled `content`.
 */
export const updateStreamingContent = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    streamingContent: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.artifactId, {
      streamingContent: args.streamingContent,
    });
    return null;
  },
});

/**
 * Defensive cleanup: clears all streaming flags without touching `content`.
 * Used by tools in their finally-block when execute fails before any of
 * the canonical settle mutations ran.
 */
export const abortStream = internalMutation({
  args: { artifactId: v.id('artifacts') },
  returns: v.null(),
  handler: async (ctx, { artifactId }) => {
    await ctx.db.patch(artifactId, {
      streamingContent: undefined,
      liveStreamMode: undefined,
      liveStreamStartedAt: undefined,
    });
    return null;
  },
});

/**
 * Janitor — clears stream flags on rows where the writer has been silent
 * past the threshold. Covers crashed agent runs that never reached a
 * tool's finally-block. Idempotent and safe to run on a cron.
 */
export const cleanupStaleStreams = internalMutation({
  args: {},
  returns: v.object({ cleared: v.number() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_STREAM_THRESHOLD_MS;
    let cleared = 0;
    for await (const row of ctx.db.query('artifacts')) {
      if (
        row.liveStreamStartedAt !== undefined &&
        row.liveStreamStartedAt < cutoff
      ) {
        await ctx.db.patch(row._id, {
          streamingContent: undefined,
          liveStreamMode: undefined,
          liveStreamStartedAt: undefined,
        });
        cleared += 1;
      }
    }
    return { cleared };
  },
});
