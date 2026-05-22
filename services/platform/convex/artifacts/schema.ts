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
  // Editing a runnable artifact via file_update re-runs the script on the
  // next artifact_run call.
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
  // Chunked content delivery introduced with the streaming-create retirement —
  // each historical `artifact_edit({mode: 'append'})` call concatenated a
  // slice onto the file's existing content. The tool is retired; the value
  // is kept here so historical `artifactRevisions` rows continue to parse.
  v.literal('append'),
  v.literal('user'),
  // File-level operations introduced with the multi-file refactor.
  v.literal('file_create'),
  v.literal('file_delete'),
  v.literal('file_rename'),
  // Project-level metadata: entry-point repoint without touching files.
  // Retained for read-validator compatibility with existing rows; the
  // The historical `set_entry` surface has been retired (use `file_rename`
  // instead — its `from === entryFile` follow-along covers the common
  // case atomically).
  v.literal('set_entry'),
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

/**
 * A single file inside an artifact's project tree. `path` is a POSIX-style
 * relative path, NFC-normalized, validated against the path-safety rules
 * in `agent_tools/artifacts/shared.ts:validatePath`.
 */
export const artifactFileValidator = v.object({
  path: v.string(),
  content: v.string(),
});

export const liveStreamModeValidator = v.union(
  v.literal('create'),
  v.literal('rewrite'),
  // Chunked content delivery — same on-the-wire shape as rewrite (content
  // streams in via tool input) but the mutation concatenates instead of
  // replacing at execute time.
  v.literal('append'),
  v.literal('patch'),
);

/**
 * Thread-scoped runnable/editable documents the LLM can create and patch
 * via the `artifact_create` + file-level CRUD tools. Lives outside the
 * message stream so a single artifact can be mutated across many turns
 * without re-emitting its full content.
 *
 * **In-flight refactor (see plan llm-majestic-hamming.md)**: many fields
 * on this row are being migrated to dedicated tables (`artifactFiles`,
 * `artifactRuns`, `artifactRunFiles`). They remain here as `@deprecated`
 * per [feedback_deprecate_dont_delete_schema_fields] so existing rows
 * keep parsing — new code reads/writes the new tables, with a fallback
 * to these fields during the migration window.
 */
export const artifactsTable = defineTable({
  organizationId: v.string(),
  threadId: v.string(),
  type: artifactTypeValidator,
  title: v.string(),
  language: v.optional(v.string()),
  /**
   * @deprecated — legacy single-file content. Phase A of the multi-file
   * refactor: marked optional; `files[entryFile].content` is the canonical
   * source. New mutations mirror entry-file content back here for rollback
   * safety. Phase C will drop this column.
   */
  content: v.optional(v.string()),
  /**
   * @deprecated — migrating to `artifactFiles` table (one row per file
   * keyed by `(artifactId, path)`). Reads still fall back here during the
   * migration window; new writes go to `artifactFiles`. Do NOT remove —
   * historical rows still carry this array.
   */
  files: v.optional(v.array(artifactFileValidator)),
  /**
   * Which file in `files[]` is the entry-point — used by `artifact_run`
   * (executed script), HTML preview (entry document), and renderers for
   * static types (the file the canvas displays by default).
   */
  entryFile: v.optional(v.string()),
  revision: v.number(),
  createdByMessageId: v.string(),
  // Cleared when the user edits the artifact via the Canvas pane — there
  // is no message to attribute. Set to the LLM message id on tool-driven edits.
  lastEditedByMessageId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  /**
   * @deprecated — transient streaming state. Migrating to the per-file
   * `artifactFiles.streamingWriteToolCallId` pointer + the agent
   * component's `streamDeltas` table. Kept on the row so historical data
   * passes the read validator; new code does not write this.
   */
  liveStreamMode: v.optional(liveStreamModeValidator),
  /** @deprecated — see {@link liveStreamMode}. */
  liveStreamStartedAt: v.optional(v.number()),
  /**
   * @deprecated — the canvas now finds the active write toolCallId on the
   * per-file `artifactFiles.streamingWriteToolCallId` pointer. Kept for
   * historical rows; new code does not write this.
   */
  toolCallId: v.optional(v.string()),
  /**
   * @deprecated — streamed content now lives in the agent component's
   * `streamDeltas` table (looked up by toolCallId). Kept for historical
   * rows that still carry partial bytes here.
   */
  streamingContent: v.optional(v.string()),
  /**
   * @deprecated — advisory streaming-path hint. Historical rows may still
   * carry it; the current `file_create` / `file_update` flow no longer
   * relies on this field as a load-bearing signal.
   */
  streamingPath: v.optional(v.string()),
  /**
   * @deprecated — patch-mode preview rendering is being moved client-side
   * over streamDeltas. Kept for historical rows.
   */
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
  /**
   * @deprecated — migrating to `artifactRunFiles` table (append-only, one
   * row per produced file per run). Reads fall back here during migration
   * window; new writes go to `artifactRunFiles` via an `artifactRuns` row.
   */
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
  .index('by_liveStreamMode', ['liveStreamMode'])
  // Backs the `artifact_create` same-message guard: when a tool call lands
  // in a thread that already produced an artifact within the same assistant
  // message (`createdByMessageId`), short-circuit to a soft-conflict
  // response steering the model toward `file_create` / `file_update`
  // instead of spawning a duplicate project.
  .index('by_organizationId_thread_createdByMessageId', [
    'organizationId',
    'threadId',
    'createdByMessageId',
  ]);

/**
 * Append-only revision history for `artifacts`. One row per write — including
 * the optimistic per-patch writes emitted during streaming. `editKind`
 * distinguishes who made the change: LLM via tool call, or the user via
 * the Canvas pane's textarea edit.
 */
export const artifactRevisionsTable = defineTable({
  artifactId: v.id('artifacts'),
  revision: v.number(),
  /**
   * @deprecated — legacy single-file content snapshot. Phase A: optional.
   * New revisions write `files` (full snapshot for content edits) instead.
   * For `editKind === 'set_entry'`, BOTH `files` and `content` are omitted
   * (pure metadata revision); read-fold logic walks back to find the most
   * recent revision carrying file state.
   */
  content: v.optional(v.string()),
  /** Full files snapshot at this revision (for content-touching edits). */
  files: v.optional(v.array(artifactFileValidator)),
  /** Entry-file pointer at this revision. */
  entryFile: v.optional(v.string()),
  /** Which file the patch/rewrite/delete operated on. */
  filePath: v.optional(v.string()),
  /** Source path for `editKind === 'file_rename'`. */
  fromPath: v.optional(v.string()),
  // Omitted when editKind === 'user' (Canvas pane textarea edit).
  editedByMessageId: v.optional(v.string()),
  editKind: artifactEditKindValidator,
  patches: v.optional(v.array(artifactPatchValidator)),
  createdAt: v.number(),
}).index('by_artifact', ['artifactId', 'revision']);

// =============================================================================
// Refactor target tables (plan: llm-majestic-hamming.md)
//
// Replace the embedded `files[]` / `runOutputFiles[]` / streaming-state
// fields on `artifactsTable` with dedicated tables. The old fields remain
// `@deprecated` on the parent row so historical data continues to parse;
// new write paths target the tables below.
// =============================================================================

/**
 * One row per source file in an artifact's project tree.
 *
 * Replaces the embedded `artifacts.files[]` array. Keyed by
 * `(artifactId, path)`. `streamingWriteToolCallId` is the only transient
 * state — set by `file_create` / `file_update` onStart, cleared on commit;
 * the canvas uses it to find the corresponding `streamDeltas` entries for
 * live content rendering.
 */
export const artifactFilesTable = defineTable({
  artifactId: v.id('artifacts'),
  path: v.string(),
  content: v.string(),
  /**
   * AI-SDK toolCallId of the active `file_create` / `file_update` (or
   * equivalent) tool call currently streaming bytes into this file. Cleared
   * on commit. When set, the canvas reads agent-component `streamDeltas`
   * filtered by this toolCallId for live content display.
   */
  streamingWriteToolCallId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_artifact_path', ['artifactId', 'path'])
  .index('by_artifact', ['artifactId']);

/**
 * One row per artifact execution attempt. Append-only — failed and
 * cancelled runs leave their row in place so the user (and the LLM via
 * `artifact_list_runs`) can see history. The next-run pre-stage resolves
 * an `inputsFromRun` reference (defaulting to "latest succeeded") to
 * decide which run's outputs to seed into `/workspace/output/`.
 */
export const artifactRunsTable = defineTable({
  artifactId: v.id('artifacts'),
  status: artifactRunStatusValidator,
  exitCode: v.optional(v.number()),
  errorCode: v.optional(artifactRunErrorCodeValidator),
  errorMessage: v.optional(v.string()),
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
  /** Artifact `revision` at the moment this run started. */
  revision: v.number(),
  /** Audit row in `sandboxExecutions` table. */
  executionId: v.optional(v.id('sandboxExecutions')),
  /**
   * The prior run whose `/workspace/output/` files were pre-staged into
   * this run's container. `undefined` means "latest succeeded was used"
   * (the default) or "nothing was pre-staged".
   */
  inputsFromRun: v.optional(v.id('artifactRuns')),
})
  .index('by_artifact', ['artifactId'])
  .index('by_artifact_status', ['artifactId', 'status'])
  // Backs `getRunByExecutionId` — `artifact_run` tool uses it to surface
  // the persistent runId to the LLM after `executeCode` returns.
  .index('by_executionId', ['executionId']);

/**
 * One row per file produced by a run (harvested from `/workspace/output/`
 * at run end). Append-only — never overwritten. A failed run that
 * produced partial files still gets rows here (per [D5]); the parent
 * `artifactRuns.status` distinguishes the source.
 */
export const artifactRunFilesTable = defineTable({
  runId: v.id('artifactRuns'),
  /** Denormalized from `artifactRuns.artifactId` for direct queries. */
  artifactId: v.id('artifacts'),
  name: v.string(),
  storageId: v.id('_storage'),
  size: v.number(),
  contentType: v.optional(v.string()),
  createdAt: v.number(),
})
  .index('by_run', ['runId'])
  .index('by_artifact', ['artifactId']);
