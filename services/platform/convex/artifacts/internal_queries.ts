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
 * Returns the prior run's outputs for pre-staging into the next sandbox run's
 * `/workspace/output/`. Reads from the new `artifactRuns` / `artifactRunFiles`
 * tables first; falls back to the deprecated `artifacts.runOutputFiles` field
 * for rows whose data hasn't been backfilled yet (per the migration plan in
 * llm-majestic-hamming.md).
 *
 * "Latest run" semantics: the most recent **successful** terminal run on this
 * artifact. Failed / cancelled runs are skipped so a one-off crash never
 * dead-ends the next pre-stage.
 */
export const getLatestRunOutputs = internalQuery({
  args: {
    artifactId: v.id('artifacts'),
    expectedOrganizationId: v.optional(v.string()),
  },
  returns: v.object({
    files: v.array(
      v.object({
        name: v.string(),
        storageId: v.id('_storage'),
        size: v.number(),
        contentType: v.optional(v.string()),
      }),
    ),
    source: v.union(
      v.literal('artifact_run_files'),
      v.literal('legacy_artifact_field'),
      v.literal('none'),
    ),
  }),
  handler: async (ctx, { artifactId, expectedOrganizationId }) => {
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) return { files: [], source: 'none' as const };
    if (
      expectedOrganizationId !== undefined &&
      artifact.organizationId !== expectedOrganizationId
    ) {
      return { files: [], source: 'none' as const };
    }

    // 1. Preferred: latest succeeded artifactRuns row + its artifactRunFiles.
    const latestSucceeded = await ctx.db
      .query('artifactRuns')
      .withIndex('by_artifact_status', (q) =>
        q.eq('artifactId', artifactId).eq('status', 'completed'),
      )
      .order('desc')
      .first();
    if (latestSucceeded !== null) {
      const runFiles = [];
      for await (const f of ctx.db
        .query('artifactRunFiles')
        .withIndex('by_run', (q) => q.eq('runId', latestSucceeded._id))) {
        runFiles.push({
          name: f.name,
          storageId: f.storageId,
          size: f.size,
          ...(f.contentType !== undefined && { contentType: f.contentType }),
        });
      }
      return {
        files: runFiles,
        source: 'artifact_run_files' as const,
      };
    }

    // 2. Fallback: legacy artifacts.runOutputFiles (migration window).
    type LegacyFile = {
      name: string;
      storageId: import('../_generated/dataModel').Id<'_storage'>;
      size: number;
      contentType?: string;
    };
    const files: LegacyFile[] = [];
    for (const f of artifact.runOutputFiles ?? []) {
      if (f.storageId === undefined) continue;
      const entry: LegacyFile = {
        name: f.name,
        storageId: f.storageId,
        size: f.size,
      };
      if (f.contentType !== undefined) entry.contentType = f.contentType;
      files.push(entry);
    }
    return {
      files,
      source:
        files.length > 0
          ? ('legacy_artifact_field' as const)
          : ('none' as const),
    };
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
