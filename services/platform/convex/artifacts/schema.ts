import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
  sandboxErrorCodeValidator,
  sandboxOutputFileValidator,
  sandboxRunProgressValidator,
  sandboxRunStatusValidator,
} from '../sandbox/wire';

export const artifactTypeValidator = v.union(
  v.literal('html'),
  v.literal('svg'),
  v.literal('markdown'),
  v.literal('mermaid'),
  v.literal('code'),
  // Runnable types: source code that executes in the server sandbox. The
  // artifact's `content` is the script; the `run*` fields below carry the
  // execution state (status, stdout/stderr preview, output files, ...).
  // Editing a runnable artifact via artifact_edit re-runs the script.
  v.literal('python_runnable'),
  v.literal('node_runnable'),
);

// Re-export the canonical sandbox validators under their legacy names so
// existing imports keep working without churn. New code should import the
// `sandbox*` names directly from `convex/sandbox/wire`.
export const artifactRunStatusValidator = sandboxRunStatusValidator;
export const artifactRunErrorCodeValidator = sandboxErrorCodeValidator;
export const artifactRunOutputFileValidator = sandboxOutputFileValidator;

export const artifactEditKindValidator = v.union(
  v.literal('create'),
  v.literal('patch'),
  v.literal('rewrite'),
  v.literal('user'),
  // Snapshot taken when a chat branch was forked: the artifact is cloned
  // from the parent thread at its current state into the new branch's
  // namespace. The `revision` on this row preserves the parent's revision
  // number at the fork moment so users see continuous version labels.
  v.literal('branch'),
);

export const artifactPatchValidator = v.object({
  search: v.string(),
  replace: v.string(),
});

export const liveStreamModeValidator = v.union(
  v.literal('create'),
  v.literal('rewrite'),
  v.literal('patch'),
);

/**
 * Thread-scoped runnable/editable documents the LLM can create and patch
 * via the `artifact_create` / `artifact_edit` tools. Lives outside the
 * message stream so a single artifact can be mutated across many turns
 * without re-emitting its full content.
 *
 * `liveStreamMode` is set while a tool call is actively writing into this
 * row. For `create` and `rewrite` modes, `streamingContent` carries the
 * partial content the LLM has emitted so far — kept off `content` so a
 * crashed write cannot corrupt the previously-settled revision. For
 * `patch` mode, `streamingContent` stays empty (the row's content does
 * not change until execute settles atomically) and the partial patches
 * are mirrored to `streamingPatches` so the UI can render an inline diff
 * preview of the regions about to change.
 */
export const artifactsTable = defineTable({
  organizationId: v.string(),
  threadId: v.string(),
  type: artifactTypeValidator,
  title: v.string(),
  language: v.optional(v.string()),
  content: v.string(),
  revision: v.number(),
  createdByMessageId: v.string(),
  // Cleared when the user edits the artifact via the Canvas pane — there
  // is no message to attribute. Set to the LLM message id on tool-driven edits.
  lastEditedByMessageId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  liveStreamMode: v.optional(liveStreamModeValidator),
  liveStreamStartedAt: v.optional(v.number()),
  // The AI-SDK toolCallId of the create/edit invocation that produced this
  // row (or whose latest edit produced it). The Canvas pane uses it to
  // filter `tool-input-delta` parts in the agent SDK's streamDeltas table
  // down to this artifact's stream and decode the partial `content` JSON
  // field client-side — that's how chat-style smooth streaming is
  // delivered without an extra deltas table on our side. Optional because
  // pre-existing rows from before this field shipped don't have it; the
  // canvas falls back to `streamingContent` for those.
  toolCallId: v.optional(v.string()),
  streamingContent: v.optional(v.string()),
  // While `liveStreamMode === 'patch'`, the partial patches array parsed
  // from the LLM's tool input is mirrored here as {search, replace} pairs
  // (only entries with a complete `search`; `replace` may still be
  // streaming in). The Canvas pane uses these to render an inline diff
  // preview over the (still settled) source — patch mode never writes
  // `streamingContent`, so this is the only mid-stream signal users have.
  streamingPatches: v.optional(v.array(artifactPatchValidator)),

  // --- Runnable-artifact run state (populated only when type is
  // `python_runnable` / `node_runnable`). All optional per the
  // [feedback_deprecate_dont_delete_schema_fields] rule so existing rows
  // pass the read validator unchanged. The canvas-runnable-code-renderer
  // subscribes to these fields for live progress + final output display.
  runPackages: v.optional(v.array(v.string())),
  runOptions: v.optional(
    v.object({
      allowSdist: v.optional(v.boolean()),
      allowInstallScripts: v.optional(v.boolean()),
    }),
  ),
  runStatus: v.optional(artifactRunStatusValidator),
  // Structured progress payload patched by the Convex action as the
  // spawner emits phase events. `kind` is rendered via the
  // `chat.runnable.progress.*` i18n keys; the optional `package` /
  // `version` fields fill ICU placeholders for `installingPackage`.
  // Server never writes user-visible English text here.
  runProgress: v.optional(sandboxRunProgressValidator),
  runStartedAt: v.optional(v.number()),
  runCompletedAt: v.optional(v.number()),
  runExitCode: v.optional(v.number()),
  runErrorCode: v.optional(artifactRunErrorCodeValidator),
  runErrorMessage: v.optional(v.string()),
  runStdoutPreview: v.optional(v.string()),
  runStderrPreview: v.optional(v.string()),
  runStdoutStorageId: v.optional(v.id('_storage')),
  runStderrStorageId: v.optional(v.id('_storage')),
  runOutputFiles: v.optional(v.array(artifactRunOutputFileValidator)),
  // Link to the latest per-execution audit row. The sandboxExecutions
  // table is the source of truth for execution history; the artifact row
  // holds only the *latest* result for fast canvas reads.
  runExecutionId: v.optional(v.id('sandboxExecutions')),
  // The `revision` the source content held when this run started. After a
  // subsequent edit bumps `revision`, the inequality `runRevision !==
  // revision` is the canonical "the displayed run is stale" signal — used
  // by buildRunAttrs (to omit run state from the LLM context) and by the
  // canvas renderer (to grey out the panel). Avoids the alternative of
  // clearing every run-state field on edit, which would surprise users by
  // wiping the prior output the moment they touch the script (round-2
  // R2-B10).
  runRevision: v.optional(v.number()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_thread', ['organizationId', 'threadId'])
  // Sparse-by-construction: rows where `liveStreamMode` is undefined are
  // excluded from this index, so the cleanup cron only walks live streams.
  .index('by_liveStreamMode', ['liveStreamMode']);

/**
 * Append-only revision history for `artifacts`. One row per write — including
 * the optimistic per-patch writes emitted during streaming. `editKind`
 * distinguishes who made the change: LLM via tool call, or the user via
 * the Canvas pane's textarea edit.
 */
export const artifactRevisionsTable = defineTable({
  artifactId: v.id('artifacts'),
  revision: v.number(),
  content: v.string(),
  // Omitted when editKind === 'user' (Canvas pane textarea edit).
  editedByMessageId: v.optional(v.string()),
  editKind: artifactEditKindValidator,
  patches: v.optional(v.array(artifactPatchValidator)),
  createdAt: v.number(),
}).index('by_artifact', ['artifactId', 'revision']);
