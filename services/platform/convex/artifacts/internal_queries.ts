import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

export const getById = internalQuery({
  args: {
    artifactId: v.id('artifacts'),
    expectedOrganizationId: v.optional(v.string()),
    expectedThreadId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { artifactId, expectedOrganizationId, expectedThreadId },
  ) => {
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) return null;
    if (
      expectedOrganizationId !== undefined &&
      artifact.organizationId !== expectedOrganizationId
    ) {
      return null;
    }
    if (
      expectedThreadId !== undefined &&
      artifact.threadId !== expectedThreadId
    ) {
      return null;
    }
    return artifact;
  },
});

export const listByThread = internalQuery({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, { organizationId, threadId }) => {
    const rows = [];
    for await (const row of ctx.db
      .query('artifacts')
      .withIndex('by_organizationId_and_thread', (q) =>
        q.eq('organizationId', organizationId).eq('threadId', threadId),
      )
      .order('asc')) {
      rows.push(row);
    }
    return rows;
  },
});

/**
 * Find the in-flight create-streaming placeholder row for a given
 * toolCallId. Used by `artifact_create.execute` as a defensive fallback
 * when the in-memory stream state (the module-level Map keyed by
 * toolCallId) is missing — e.g. when `onInputDelta`'s placeholder insert
 * mutation hadn't returned by the time `execute` started, so
 * `state.artifactId` was still undefined and the tool was about to insert
 * a duplicate row. Lookup is scoped to org+thread (so an orphan from a
 * different conversation can't be claimed) and to `liveStreamMode='create'`
 * (we never want to overwrite an already-settled artifact). No index on
 * toolCallId — orphan resolution is rare and the thread's recent artifacts
 * are a small set, so an index walk over `by_organizationId_and_thread` is
 * cheap.
 */
export const findStreamingPlaceholderByToolCallId = internalQuery({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    toolCallId: v.string(),
  },
  handler: async (ctx, { organizationId, threadId, toolCallId }) => {
    for await (const row of ctx.db
      .query('artifacts')
      .withIndex('by_organizationId_and_thread', (q) =>
        q.eq('organizationId', organizationId).eq('threadId', threadId),
      )) {
      if (row.toolCallId === toolCallId && row.liveStreamMode === 'create') {
        return row;
      }
    }
    return null;
  },
});
