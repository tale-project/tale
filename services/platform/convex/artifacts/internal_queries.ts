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
 * Returns the first artifact in this thread whose `createdByMessageId` matches
 * the supplied id, or null. Backs the `artifact_create` same-message guard:
 * the tool short-circuits to a soft-conflict response so the model uses
 * `artifact_edit` instead of spawning a duplicate project on the same reply.
 *
 * Caller must pass a non-empty `createdByMessageId` — empty-string artifacts
 * from multi-step / sub-agent edge cases would otherwise cross-match.
 */
export const findArtifactByCreatedMessage = internalQuery({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    createdByMessageId: v.string(),
  },
  handler: async (ctx, { organizationId, threadId, createdByMessageId }) => {
    if (createdByMessageId === '') return null;
    return await ctx.db
      .query('artifacts')
      .withIndex('by_organizationId_thread_createdByMessageId', (q) =>
        q
          .eq('organizationId', organizationId)
          .eq('threadId', threadId)
          .eq('createdByMessageId', createdByMessageId),
      )
      .first();
  },
});
