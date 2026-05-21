import { type Infer, ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { applyPatches } from '../agent_tools/artifacts/apply_patches';
import {
  sandboxRunProgressValidator,
  sandboxTerminalStatuses,
} from '../sandbox/wire';
import {
  artifactPatchValidator,
  artifactRunErrorCodeValidator,
  artifactRunOutputFileValidator,
  artifactRunStatusValidator,
  artifactTypeValidator,
  liveStreamModeValidator,
} from './schema';

type ArtifactRunErrorCode = Infer<typeof artifactRunErrorCodeValidator>;
type ArtifactRunOutputFile = Infer<typeof artifactRunOutputFileValidator>;

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
 * Patch a streaming-create placeholder row into its settled form and append
 * the matching `artifactRevisions` row. Plain helper (not an `internalMutation`)
 * so callers inside another mutation transaction can invoke it — Convex
 * disallows nested `runMutation`. Mirrors `applyFinalizeArtifactRun` below.
 */
export async function applyFinalizeStreamedCreate(
  ctx: MutationCtx,
  args: {
    artifactId: Id<'artifacts'>;
    title: string;
    language?: string;
    content: string;
    editedByMessageId: string;
    revision: number;
  },
): Promise<void> {
  const now = Date.now();
  await ctx.db.patch(args.artifactId, {
    title: args.title,
    language: args.language,
    content: args.content,
    streamingContent: undefined,
    streamingPatches: undefined,
    liveStreamMode: undefined,
    liveStreamStartedAt: undefined,
    toolCallId: undefined,
    updatedAt: now,
  });
  await ctx.db.insert('artifactRevisions', {
    artifactId: args.artifactId,
    revision: args.revision,
    content: args.content,
    editedByMessageId: args.editedByMessageId,
    editKind: 'create',
    createdAt: now,
  });
}

/**
 * Insert a new artifact (revision 1) and its initial revision row. Used by
 * the `artifact_create` tool both at the streaming-placeholder moment
 * (`liveStreamMode='create'`, empty content) and at the final settle
 * (no `liveStreamMode`, full content).
 *
 * Idempotent on `toolCallId`: the tool's `onInputDelta` and `execute` hooks
 * each call this mutation in separate Convex transactions. Convex per-mutation
 * atomicity does NOT extend across two `runMutation` calls from the same
 * action — so without dedup, a slow placeholder insert could let `execute`
 * fall through to a second insert, producing two rows for one tool call.
 *
 * The dedup pattern: scan the org+thread index for an existing row carrying
 * the same `toolCallId`. If found, return / finalize-in-place instead of
 * inserting. Convex OCC validates the read range at commit time; if the
 * other half of the race committed first, the loser's read set is
 * invalidated and the runtime retries — on retry the loser sees the
 * winner's row and takes the dedup branch. Net result: exactly one row per
 * `toolCallId`, regardless of timing.
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
    // Set by the artifact_create tool so the canvas can filter
    // `tool-input-delta` rows in the agent SDK's streamDeltas down to this
    // artifact's stream during the create flow. Also used as the dedup key
    // — see header comment.
    toolCallId: v.optional(v.string()),
  },
  returns: v.object({ artifactId: v.id('artifacts'), revision: v.number() }),
  handler: async (ctx, args) => {
    assertContentSize(args.content);
    const now = Date.now();
    const isStreaming = args.liveStreamMode !== undefined;

    if (args.toolCallId !== undefined) {
      for await (const row of ctx.db
        .query('artifacts')
        .withIndex('by_organizationId_and_thread', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('threadId', args.threadId),
        )) {
        if (row.toolCallId !== args.toolCallId) continue;
        if (isStreaming) {
          // Streaming-write caller arriving on an existing row: a duplicate
          // `onInputDelta` insert (the synchronous `rowInitialized` guard in
          // stream_state.ts normally prevents this, defensive belt-and-suspenders).
          return { artifactId: row._id, revision: row.revision };
        }
        if (row.liveStreamMode === 'create') {
          // Settle caller arriving on the placeholder: finalize in place.
          await applyFinalizeStreamedCreate(ctx, {
            artifactId: row._id,
            title: args.title,
            language: args.language,
            content: args.content,
            editedByMessageId: args.createdByMessageId,
            revision: row.revision,
          });
          return { artifactId: row._id, revision: row.revision };
        }
        // Settle caller arriving on an already-settled row: idempotent return.
        return { artifactId: row._id, revision: row.revision };
      }
    }

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
      toolCallId: args.toolCallId,
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
 *
 * Kept as an external entry point for callers that already hold the
 * placeholder's `artifactId`. The `artifact_create` tool no longer calls
 * this directly — `createArtifact` itself handles the finalize-in-place
 * branch via `applyFinalizeStreamedCreate` so the dedup logic stays in
 * one place. Retained for future admin/repair scripts that may want a
 * targeted finalize without going through the dedup index scan.
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
    await applyFinalizeStreamedCreate(ctx, {
      artifactId: args.artifactId,
      title: args.title,
      language: args.language,
      content: args.content,
      editedByMessageId: args.editedByMessageId,
      revision: artifact.revision,
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
      toolCallId: undefined,
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
      toolCallId: undefined,
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
    // Set by the artifact_edit tool so the canvas can filter
    // `tool-input-delta` rows down to this edit's stream. Stored on the row
    // so subscribers can pick up the right toolCallId without a separate
    // round-trip; cleared at settle alongside the other streaming flags.
    toolCallId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.artifactId, {
      liveStreamMode: args.liveStreamMode,
      liveStreamStartedAt: Date.now(),
      streamingContent: args.liveStreamMode === 'rewrite' ? '' : undefined,
      streamingPatches: args.liveStreamMode === 'patch' ? [] : undefined,
      toolCallId: args.toolCallId,
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
      toolCallId: undefined,
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
          toolCallId: undefined,
        });
        cleared += 1;
      }
    }
    return { cleared };
  },
});

// =============================================================================
// Runnable-artifact run-state mutations (Refinement 2)
// =============================================================================
//
// These mutate the `run*` fields on a runnable artifact (`python_runnable` /
// `node_runnable`). The executeCode internal action calls them between
// `setRunning` and `finalize` as PHASE markers stream from the spawner.
// The canvas-runnable-code-renderer subscribes to the artifact row and
// gets reactive updates for the progress chip + output file display.

/**
 * Persist run config (packages / install-script options) on a runnable
 * artifact row WITHOUT touching `runStatus`. Called by `artifact_create`
 * after the source settles so the separate `artifact_run` tool can pick
 * up these defaults later. Distinct from `initArtifactRun` which also
 * resets run-state fields and queues the row — that's only correct when
 * a run is actually about to start.
 */
export const setArtifactRunConfig = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    runPackages: v.array(v.string()),
    runOptions: v.optional(
      v.object({
        allowSdist: v.optional(v.boolean()),
        allowInstallScripts: v.optional(v.boolean()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.artifactId);
    if (!row) return null;
    if (row.type !== 'python_runnable' && row.type !== 'node_runnable') {
      return null;
    }
    await ctx.db.patch(args.artifactId, {
      runPackages: args.runPackages,
      ...(args.runOptions !== undefined && { runOptions: args.runOptions }),
    });
    return null;
  },
});

/**
 * Reset the artifact's per-execution state to "queued" before kicking off
 * a new run. Does NOT touch `runPackages` / `runOptions` — those are
 * create-time defaults stored on the row by `setArtifactRunConfig`; the
 * agent's per-call `artifact_run` override is applied transiently to the
 * spawner request, not persisted. This keeps the documented contract
 * ("one-off overrides for THIS run only") matching the actual behavior.
 */
export const initArtifactRun = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.artifactId);
    if (!row) return null;
    if (row.type !== 'python_runnable' && row.type !== 'node_runnable') {
      // Defensive: callers should only invoke this on runnable types. Skip
      // silently so an out-of-band call can't corrupt a static artifact.
      return null;
    }
    // Refuse to reset a run that's still in flight. Two parallel artifact_run
    // tool calls on the same artifact would otherwise both reset the row to
    // 'queued', drop each other's progress events, and leak a sandbox slot.
    // The artifact_run tool catches this and returns a structured failure so
    // the LLM gets a clear "wait for the current run to finish" signal.
    if (
      row.runStatus === 'queued' ||
      row.runStatus === 'installing' ||
      row.runStatus === 'running'
    ) {
      throw new ConvexError({
        code: 'RUN_IN_FLIGHT',
        message: `artifact ${args.artifactId} already has a run in flight (status: ${row.runStatus}); wait for it to settle before starting another.`,
      });
    }
    await ctx.db.patch(args.artifactId, {
      runStatus: 'queued',
      runProgress: { kind: 'queued' },
      runStartedAt: Date.now(),
      // Pin the revision this run is executing against. After a later edit
      // bumps `revision`, `buildRunAttrs` + canvas renderer compare against
      // this to decide whether the displayed run state is still fresh
      // (round-2 R2-B10).
      runRevision: row.revision,
      // Clear any stale fields from a prior run of the same artifact (the
      // edit flow re-uses the row for subsequent executions).
      runCompletedAt: undefined,
      runExitCode: undefined,
      runErrorCode: undefined,
      runErrorMessage: undefined,
      runStdoutPreview: undefined,
      runStderrPreview: undefined,
      runStdoutStorageId: undefined,
      runStderrStorageId: undefined,
      runOutputFiles: [],
      runExecutionId: undefined,
    });
    return null;
  },
});

export const patchArtifactRunProgress = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    runStatus: v.optional(artifactRunStatusValidator),
    runProgress: v.optional(sandboxRunProgressValidator),
    runExecutionId: v.optional(v.id('sandboxExecutions')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.artifactId);
    if (!row) return null;
    if (row.type !== 'python_runnable' && row.type !== 'node_runnable') {
      return null;
    }
    // Refuse to rewind a terminal artifact: a late phase event arriving
    // after finalizeArtifactRun must not flip the canvas back to running.
    if (
      row.runStatus !== undefined &&
      sandboxTerminalStatuses.has(row.runStatus)
    ) {
      console.warn(
        `[patchArtifactRunProgress] no-op: artifact ${args.artifactId} already terminal as ${row.runStatus}`,
      );
      return null;
    }
    const patch: Record<string, unknown> = {};
    if (args.runStatus !== undefined) patch.runStatus = args.runStatus;
    if (args.runProgress !== undefined) patch.runProgress = args.runProgress;
    if (args.runExecutionId !== undefined) {
      patch.runExecutionId = args.runExecutionId;
    }
    if (Object.keys(patch).length === 0) return null;
    await ctx.db.patch(args.artifactId, patch);
    return null;
  },
});

/**
 * Shared finalize logic so mutations that can't call into other mutations
 * directly (Convex disallows nested `runMutation` inside a mutation) can
 * still terminate an artifact row from the same transaction — e.g. the
 * sandbox watchdog cascading failure when it reaps a stuck execution.
 */
export async function applyFinalizeArtifactRun(
  ctx: MutationCtx,
  args: {
    artifactId: Id<'artifacts'>;
    runStatus: 'completed' | 'failed' | 'cancelled';
    runExitCode?: number;
    runErrorCode?: ArtifactRunErrorCode;
    runErrorMessage?: string;
    runStdoutPreview?: string;
    runStderrPreview?: string;
    runStdoutStorageId?: Id<'_storage'>;
    runStderrStorageId?: Id<'_storage'>;
    runOutputFiles: ArtifactRunOutputFile[];
    // Optional because a tool-side catch path may fire before
    // reserveSlotAndInsert ever returned an executionId (e.g. QUOTA_EXCEEDED
    // pre-insert). In that case we leave the artifact row's existing
    // runExecutionId untouched.
    runExecutionId?: Id<'sandboxExecutions'>;
  },
): Promise<void> {
  const row = await ctx.db.get(args.artifactId);
  if (!row) return;
  if (row.type !== 'python_runnable' && row.type !== 'node_runnable') {
    return;
  }
  // Monotonic guard mirrors `sandbox.finalize`: a late infra-failure path
  // calling finalizeArtifactRun must not clobber a watchdog-written
  // failed/cancelled state. The race window here is the same one
  // failExecution's per-run rollback is designed to close — when both
  // hit, the first writer wins.
  if (
    row.runStatus !== undefined &&
    sandboxTerminalStatuses.has(row.runStatus)
  ) {
    console.warn(
      `[finalizeArtifactRun] no-op: artifact ${args.artifactId} already terminal as ${row.runStatus}; dropping incoming ${args.runStatus}`,
    );
    return;
  }
  await ctx.db.patch(args.artifactId, {
    runStatus: args.runStatus,
    runProgress: undefined,
    runCompletedAt: Date.now(),
    ...(args.runExitCode !== undefined && { runExitCode: args.runExitCode }),
    ...(args.runErrorCode !== undefined && {
      runErrorCode: args.runErrorCode,
    }),
    ...(args.runErrorMessage !== undefined && {
      runErrorMessage: args.runErrorMessage,
    }),
    ...(args.runStdoutPreview !== undefined && {
      runStdoutPreview: args.runStdoutPreview,
    }),
    ...(args.runStderrPreview !== undefined && {
      runStderrPreview: args.runStderrPreview,
    }),
    ...(args.runStdoutStorageId !== undefined && {
      runStdoutStorageId: args.runStdoutStorageId,
    }),
    ...(args.runStderrStorageId !== undefined && {
      runStderrStorageId: args.runStderrStorageId,
    }),
    runOutputFiles: args.runOutputFiles,
    ...(args.runExecutionId !== undefined && {
      runExecutionId: args.runExecutionId,
    }),
  });
}

export const finalizeArtifactRun = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    runStatus: v.union(
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    runExitCode: v.optional(v.number()),
    runErrorCode: v.optional(artifactRunErrorCodeValidator),
    runErrorMessage: v.optional(v.string()),
    runStdoutPreview: v.optional(v.string()),
    runStderrPreview: v.optional(v.string()),
    runStdoutStorageId: v.optional(v.id('_storage')),
    runStderrStorageId: v.optional(v.id('_storage')),
    runOutputFiles: v.array(artifactRunOutputFileValidator),
    runExecutionId: v.optional(v.id('sandboxExecutions')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await applyFinalizeArtifactRun(ctx, args);
    return null;
  },
});
