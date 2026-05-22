/**
 * Handler bodies + validators for streaming-lifecycle mutations:
 * beginEditStream, abortStream, updateRewriteStreamingContent,
 * discardActiveStreamsForThread, cleanupStaleStreams.
 *
 * These manage the transient "currently-streaming" state on the artifact
 * row (liveStreamMode, streamingContent, streamingPath, etc.) — kept off
 * the canonical content fields so a crashed write cannot corrupt settled
 * revisions.
 */

import { ConvexError, v } from 'convex/values';

import type { MutationCtx } from '../../_generated/server';
import { validatePath } from '../../agent_tools/artifacts/shared';
import { liveStreamModeValidator } from '../schema';
import { STALE_STREAM_THRESHOLD_MS, clearStreamingFlags } from './shared';

// =============================================================================
// beginEditStream — single-writer guard + initial streaming state
// =============================================================================

export const beginEditStreamArgs = {
  artifactId: v.id('artifacts'),
  liveStreamMode: liveStreamModeValidator,
  /** For mode='rewrite': the file path being streamed (advisory). */
  streamingPath: v.optional(v.string()),
  toolCallId: v.optional(v.string()),
} as const;

export const beginEditStreamReturns = v.null();

export async function beginEditStreamHandler(
  ctx: MutationCtx,
  args: {
    artifactId: import('../../_generated/dataModel').Id<'artifacts'>;
    liveStreamMode: 'create' | 'rewrite' | 'append' | 'patch';
    streamingPath?: string;
    toolCallId?: string;
  },
) {
  const row = await ctx.db.get(args.artifactId);
  if (!row) {
    throw new ConvexError({
      code: 'not_found',
      message: `Artifact ${args.artifactId} not found.`,
    });
  }
  // Refuse if another stream is already in flight on this row.
  if (row.liveStreamMode !== undefined) {
    throw new ConvexError({
      code: 'streaming_in_progress',
      message: `Another edit is already streaming to artifact ${args.artifactId} (mode: ${row.liveStreamMode}). Wait for it to settle.`,
    });
  }
  const validatedPath =
    args.streamingPath !== undefined
      ? validatePath(args.streamingPath)
      : undefined;
  await ctx.db.patch(args.artifactId, {
    liveStreamMode: args.liveStreamMode,
    liveStreamStartedAt: Date.now(),
    // `rewrite` and `append` both deliver content via tool-input deltas; we
    // seed `streamingContent` to the empty string so the canvas's
    // `streamingContent ?? settled` fallback chain has a stable handle
    // through the stream. `patch` uses `streamingPatches` instead.
    streamingContent:
      args.liveStreamMode === 'rewrite' || args.liveStreamMode === 'append'
        ? ''
        : undefined,
    streamingPatches: args.liveStreamMode === 'patch' ? [] : undefined,
    streamingPath: validatedPath,
    toolCallId: args.toolCallId,
  });
  return null;
}

// =============================================================================
// abortStream — clears all live-stream flags
// =============================================================================

export const abortStreamArgs = {
  artifactId: v.id('artifacts'),
} as const;

export const abortStreamReturns = v.null();

export async function abortStreamHandler(
  ctx: MutationCtx,
  {
    artifactId,
  }: { artifactId: import('../../_generated/dataModel').Id<'artifacts'> },
) {
  await ctx.db.patch(artifactId, clearStreamingFlags());
  return null;
}

// =============================================================================
// updateRewriteStreamingContent — mid-stream incremental persistence
//
// Bails (no-op) if the row no longer matches the streaming session
// (different `toolCallId`, mode changed, path changed) — protects against
// a stale delta from an aborted call overwriting a newer stream.
//
// Never touches `files[]`, `content`, or `revision`. Settled state stays
// exactly as it was until `rewriteArtifact` / `appendToFile` runs at
// execute-time.
//
// Shared by `artifact_edit({mode:'rewrite'})` and
// `artifact_edit({mode:'append'})` — both stream their `content` arg in via
// tool-input deltas, so the canvas's "show whatever bytes we've seen so
// far" path is identical.
// =============================================================================

export const updateRewriteStreamingContentArgs = {
  artifactId: v.id('artifacts'),
  toolCallId: v.string(),
  streamingPath: v.string(),
  content: v.string(),
} as const;

export const updateRewriteStreamingContentReturns = v.null();

export async function updateRewriteStreamingContentHandler(
  ctx: MutationCtx,
  args: {
    artifactId: import('../../_generated/dataModel').Id<'artifacts'>;
    toolCallId: string;
    streamingPath: string;
    content: string;
  },
) {
  const row = await ctx.db.get(args.artifactId);
  if (!row) return null;
  if (row.liveStreamMode !== 'rewrite' && row.liveStreamMode !== 'append') {
    return null;
  }
  if (row.toolCallId !== args.toolCallId) return null;
  if (row.streamingPath !== args.streamingPath) return null;
  await ctx.db.patch(args.artifactId, {
    streamingContent: args.content,
    updatedAt: Date.now(),
  });
  return null;
}

// =============================================================================
// discardActiveStreamsForThread — user-Stop cascade
//
// When the user clicks Stop, the SDK abort fires before any `tool.execute()`
// runs, so `discardCreateStream` / `abortStream` never get called for the
// stream that was mid-author. Without this mutation the placeholder row
// (revision 0, `liveStreamMode='create'`) lingers in the canvas sidebar
// with a streaming badge until `cleanupStaleStreams` cron picks it up
// (60 s threshold × 5-min cron = up to ~6 min ghost tile).
//
// Mirror of `cleanupStaleStreams` logic but scoped to one thread and not
// gated on `liveStreamStartedAt` age. Called inline from
// `convex/threads/cancel_generation.ts`.
// =============================================================================

export const discardActiveStreamsForThreadArgs = {
  organizationId: v.string(),
  threadId: v.string(),
} as const;

export const discardActiveStreamsForThreadReturns = v.object({
  cleared: v.number(),
});

export async function discardActiveStreamsForThreadHandler(
  ctx: MutationCtx,
  args: { organizationId: string; threadId: string },
) {
  let cleared = 0;
  const rows = await ctx.db
    .query('artifacts')
    .withIndex('by_organizationId_and_thread', (q) =>
      q.eq('organizationId', args.organizationId).eq('threadId', args.threadId),
    )
    .collect();
  for (const row of rows) {
    if (row.liveStreamMode === undefined) continue;
    if (row.revision === 0) {
      await ctx.db.delete(row._id);
    } else {
      await ctx.db.patch(row._id, clearStreamingFlags());
    }
    cleared += 1;
  }
  return { cleared };
}

// =============================================================================
// cleanupStaleStreams — periodic janitor (cron-invoked)
// =============================================================================

export const cleanupStaleStreamsArgs = {} as const;

export const cleanupStaleStreamsReturns = v.object({ cleared: v.number() });

export async function cleanupStaleStreamsHandler(ctx: MutationCtx) {
  const cutoff = Date.now() - STALE_STREAM_THRESHOLD_MS;
  let cleared = 0;
  for await (const row of ctx.db
    .query('artifacts')
    .withIndex('by_liveStreamMode')) {
    if (
      row.liveStreamStartedAt !== undefined &&
      row.liveStreamStartedAt < cutoff
    ) {
      // Placeholder rows (revision === 0) belong to a crashed
      // `beginCreateStream` and have no real artifactRevisions row backing
      // them — clearing streaming flags would leak an empty artifact into
      // the user's thread, so we delete the row outright. For settled
      // rows (revision >= 1) we just clear the streaming flags and keep
      // the prior content.
      if (row.revision === 0) {
        await ctx.db.delete(row._id);
      } else {
        await ctx.db.patch(row._id, clearStreamingFlags());
      }
      cleared += 1;
    }
  }
  return { cleared };
}
