import { ConvexError, v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { applyPatches } from '../agent_tools/artifacts/apply_patches';
import {
  artifactPatchValidator,
  artifactTypeValidator,
  liveStreamModeValidator,
} from './schema';

const STALE_STREAM_THRESHOLD_MS = 60_000;
/**
 * Minimum interval between `liveStreamStartedAt` heartbeat refreshes inside
 * `updateStreamingContent`. The cron janitor (`cleanupStaleStreams`) reaps
 * any row whose heartbeat is older than `STALE_STREAM_THRESHOLD_MS`, so
 * refreshing the heartbeat well inside that window is sufficient. Skipping
 * the redundant patch on every chunk also keeps the doc-level `useQuery`
 * subscriptions (artifact-bar, MessageArtifactPills) from re-running on
 * every flush — content-stream flushes happen every ~100-250 ms, but the
 * subscribed queries only need to invalidate when their projected metadata
 * (title, revision, liveStreamMode) actually changed. Must stay <<
 * STALE_STREAM_THRESHOLD_MS.
 */
const HEARTBEAT_THROTTLE_MS = 5_000;

/**
 * Hard cap on a stored artifact's content (settled or streaming). Convex's
 * per-document limit is 1 MiB; we cap below that so a single mutation that
 * also writes a revision row (which stores the same content) stays under
 * the limit, and so an LLM rewrite that runs away yields a clean
 * `too_large` error instead of a generic 500.
 */
export const MAX_ARTIFACT_BYTES = 800_000;

export function assertContentSize(content: string): void {
  const size = new TextEncoder().encode(content).byteLength;
  if (size > MAX_ARTIFACT_BYTES) {
    throw new ConvexError({
      code: 'too_large',
      message: `Artifact content is ${size} bytes; max ${MAX_ARTIFACT_BYTES}.`,
    });
  }
}

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
    assertContentSize(args.content);
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
 * write the canonical title/language/content, drop streamingContent,
 * write the initial revision row, and clear streaming flags.
 */
export const finalizeStreamedCreate = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    title: v.string(),
    language: v.optional(v.string()),
    content: v.string(),
    editedByMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertContentSize(args.content);
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact) {
      throw new ConvexError({
        code: 'not_found',
        message: `artifact ${args.artifactId} not found during finalize.`,
      });
    }
    if (artifact.liveStreamMode !== 'create') {
      // Defensive: the placeholder row was tampered with (e.g. a userEdit
      // landed on a streaming-create row, or another tool-call clobbered
      // the flags). Hard-fail so the agent can recover, instead of writing
      // a revision row that desynchronises with the artifact's content.
      throw new ConvexError({
        code: 'lifecycle',
        message: `artifact ${args.artifactId} is not in create-streaming state.`,
      });
    }
    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      title: args.title,
      language: args.language,
      content: args.content,
      streamingContent: undefined,
      streamingPatches: undefined,
      liveStreamMode: undefined,
      liveStreamStartedAt: undefined,
      updatedAt: now,
    });
    await ctx.db.insert('artifactRevisions', {
      artifactId: args.artifactId,
      revision: artifact.revision,
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
    // OCC guard — the revision the caller read when planning these patches.
    // Mismatch means another writer landed between the read and this call,
    // so the patch's `search` snippets may now match the wrong region.
    expectedRevision: v.number(),
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
      stale: v.optional(v.boolean()),
      currentRevision: v.optional(v.number()),
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
    if (artifact.revision !== args.expectedRevision) {
      return {
        success: false as const,
        error: `artifact has been modified since you last read it (revision ${artifact.revision}, you sent ${args.expectedRevision}). Re-read and retry.`,
        failedIndex: 0,
        stale: true,
        currentRevision: artifact.revision,
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
    assertContentSize(result.content);
    const nextRevision = artifact.revision + 1;
    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      content: result.content,
      revision: nextRevision,
      lastEditedByMessageId: args.editedByMessageId,
      streamingContent: undefined,
      streamingPatches: undefined,
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
    expectedRevision: v.number(),
  },
  returns: v.union(
    v.object({ success: v.literal(true), revision: v.number() }),
    v.object({
      success: v.literal(false),
      stale: v.literal(true),
      currentRevision: v.number(),
      error: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    assertContentSize(args.content);
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact) {
      throw new Error(`artifact ${args.artifactId} not found`);
    }
    if (artifact.revision !== args.expectedRevision) {
      return {
        success: false as const,
        stale: true as const,
        currentRevision: artifact.revision,
        error: `artifact has been modified since you last read it (revision ${artifact.revision}, you sent ${args.expectedRevision}). Re-read and retry.`,
      };
    }
    const nextRevision = artifact.revision + 1;
    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      content: args.content,
      revision: nextRevision,
      lastEditedByMessageId: args.editedByMessageId,
      streamingContent: undefined,
      streamingPatches: undefined,
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
    return { success: true as const, revision: nextRevision };
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
      streamingPatches: args.liveStreamMode === 'patch' ? [] : undefined,
    });
    return null;
  },
});

/**
 * Throttled-by-the-caller update of the partial content as the LLM streams
 * its tool-call argument. Writes to the shadow `streamingContent` field so
 * a mid-stream crash cannot corrupt the previously-settled `content`. The
 * title and language fields are also patched here as they grow during
 * streaming — titles are short enough that throttling them isn't worth it.
 *
 * For `mode: 'patch'` streams, `streamingPatches` is populated with the
 * partial list of `search` snippets so the Canvas pane can highlight which
 * regions are about to change.
 */
export const updateStreamingContent = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    streamingContent: v.optional(v.string()),
    title: v.optional(v.string()),
    language: v.optional(v.string()),
    streamingPatches: v.optional(v.array(artifactPatchValidator)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.streamingContent !== undefined) {
      assertContentSize(args.streamingContent);
    }
    const patch: Record<string, unknown> = {};
    if (args.streamingContent !== undefined) {
      patch.streamingContent = args.streamingContent;
    }
    if (args.title !== undefined) patch.title = args.title;
    if (args.language !== undefined) patch.language = args.language;
    if (args.streamingPatches !== undefined) {
      patch.streamingPatches = args.streamingPatches;
    }
    if (Object.keys(patch).length === 0) return null;
    // Refresh the liveness timestamp at most every HEARTBEAT_THROTTLE_MS.
    // `liveStreamStartedAt` is the watchdog input for `cleanupStaleStreams`;
    // refreshing inside the threshold window is enough to keep the row alive
    // and avoids invalidating doc-level Convex subscriptions on every chunk.
    const existing = await ctx.db.get(args.artifactId);
    const now = Date.now();
    const lastBeat = existing?.liveStreamStartedAt ?? 0;
    if (now - lastBeat >= HEARTBEAT_THROTTLE_MS) {
      patch.liveStreamStartedAt = now;
    }
    await ctx.db.patch(args.artifactId, patch);
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
      streamingPatches: undefined,
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
    // The `by_liveStreamMode` index is sparse: rows with `liveStreamMode`
    // undefined are not in it. So this iterator only touches active streams.
    for await (const row of ctx.db
      .query('artifacts')
      .withIndex('by_liveStreamMode')) {
      if (
        row.liveStreamStartedAt !== undefined &&
        row.liveStreamStartedAt < cutoff
      ) {
        await ctx.db.patch(row._id, {
          streamingContent: undefined,
          streamingPatches: undefined,
          liveStreamMode: undefined,
          liveStreamStartedAt: undefined,
        });
        cleared += 1;
      }
    }
    return { cleared };
  },
});
