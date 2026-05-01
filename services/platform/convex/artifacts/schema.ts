import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const artifactTypeValidator = v.union(
  v.literal('html'),
  v.literal('svg'),
  v.literal('markdown'),
  v.literal('mermaid'),
  v.literal('code'),
);

export const artifactEditKindValidator = v.union(
  v.literal('create'),
  v.literal('patch'),
  v.literal('rewrite'),
  v.literal('user'),
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
 * `patch` mode, `streamingContent` is unused; the UI shows a spinner
 * until the tool's `execute` applies the patches atomically.
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
  streamingContent: v.optional(v.string()),
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
