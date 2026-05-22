import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { loadArtifactWithFiles, resolveArtifactFiles } from './resolve_files';

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
    const artifact = await loadArtifactWithFiles(ctx, artifactId);
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
 * Pre-stage source selection:
 *   - omitted `fromRun` (or `"latest"`): most recent **successful** terminal
 *     run on this artifact; failed/cancelled runs are skipped so a one-off
 *     crash never dead-ends the next pre-stage.
 *   - explicit runId string: pin to that exact run's outputs regardless of
 *     status. Errors silently fall through to the legacy fallback if the id
 *     is malformed or doesn't belong to this artifact.
 */
export const getLatestRunOutputs = internalQuery({
  args: {
    artifactId: v.id('artifacts'),
    expectedOrganizationId: v.optional(v.string()),
    fromRun: v.optional(v.string()),
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
  handler: async (ctx, { artifactId, expectedOrganizationId, fromRun }) => {
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) return { files: [], source: 'none' as const };
    if (
      expectedOrganizationId !== undefined &&
      artifact.organizationId !== expectedOrganizationId
    ) {
      return { files: [], source: 'none' as const };
    }

    // 1a. Explicit pin: caller named a specific runId. Resolve it and
    //     return that run's files (status-agnostic). Bail to the default
    //     path if the id is malformed or scoped to a different artifact.
    if (fromRun !== undefined && fromRun !== 'latest') {
      let pinnedRun: Awaited<ReturnType<typeof ctx.db.get<'artifactRuns'>>> =
        null;
      try {
        const pinnedRunId = ctx.db.normalizeId('artifactRuns', fromRun);
        if (pinnedRunId !== null) {
          pinnedRun = await ctx.db.get(pinnedRunId);
        }
      } catch (err) {
        console.warn(
          '[getLatestRunOutputs] malformed fromRun id, falling back:',
          err,
        );
      }
      if (pinnedRun !== null && pinnedRun.artifactId === artifactId) {
        const pinnedFiles = [];
        for await (const f of ctx.db
          .query('artifactRunFiles')
          .withIndex('by_run', (q) => q.eq('runId', pinnedRun._id))) {
          pinnedFiles.push({
            name: f.name,
            storageId: f.storageId,
            size: f.size,
            ...(f.contentType !== undefined && { contentType: f.contentType }),
          });
        }
        return {
          files: pinnedFiles,
          source: 'artifact_run_files' as const,
        };
      }
    }

    // 1b. Default: latest succeeded artifactRuns row + its artifactRunFiles.
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
 * Returns the `artifactRuns` row created by `applyFinalizeArtifactRun` for
 * a given sandbox `executionId`, or null if the run never finalized (rare
 * — only infra crashes that bypass the finalize path). Used by
 * `artifact_run` to surface the persistent run id to the LLM so a later
 * call can pin pre-staging via `inputs: { from_run: "<runId>" }`.
 */
export const getRunByExecutionId = internalQuery({
  args: { executionId: v.id('sandboxExecutions') },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id('artifactRuns'),
      artifactId: v.id('artifacts'),
      status: v.string(),
    }),
  ),
  handler: async (ctx, { executionId }) => {
    const row = await ctx.db
      .query('artifactRuns')
      .withIndex('by_executionId', (q) => q.eq('executionId', executionId))
      .first();
    if (row === null) return null;
    return {
      _id: row._id,
      artifactId: row.artifactId,
      status: row.status,
    };
  },
});

/**
 * Returns the first artifact in this thread whose `createdByMessageId` matches
 * the supplied id, or null. Backs the `artifact_create` same-message guard:
 * the tool short-circuits to a soft-conflict response so the model uses
 * `artifact_file_create` / `artifact_file_update` instead of spawning a duplicate project on the same reply.
 *
 * Caller must pass a non-empty `createdByMessageId` — empty-string artifacts
 * from multi-step / sub-agent edge cases would otherwise cross-match.
 */
/**
 * List all files in an artifact (metadata only — path + size). Backs the
 * `artifact_file_list` agent tool. Reads canonical `artifactFiles` rows; falls back
 * to the artifact-row `files[]` / synthesized-from-`content` projection
 * via `resolveArtifactFiles` for rows that predate the multi-file refactor.
 */
export const listFilesByArtifact = internalQuery({
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
    const rows = [];
    for await (const row of ctx.db
      .query('artifactFiles')
      .withIndex('by_artifact', (q) => q.eq('artifactId', artifactId))) {
      rows.push(row);
    }
    if (rows.length > 0) {
      const resolved = resolveArtifactFiles(artifact);
      return {
        artifactId,
        revision: artifact.revision,
        type: artifact.type,
        title: artifact.title,
        language: artifact.language,
        entryFile: resolved.entryFile,
        files: rows.map((r) => ({
          path: r.path,
          size: new TextEncoder().encode(r.content).byteLength,
        })),
      };
    }
    // Fallback: row predates artifactFiles backfill — derive from doc.
    const resolved = resolveArtifactFiles(artifact);
    return {
      artifactId,
      revision: artifact.revision,
      type: artifact.type,
      title: artifact.title,
      language: artifact.language,
      entryFile: resolved.entryFile,
      files: resolved.files.map((f) => ({
        path: f.path,
        size: new TextEncoder().encode(f.content).byteLength,
      })),
    };
  },
});

/**
 * Read file contents by exact path(s). Backs the `artifact_file_read` agent tool.
 * Returns each requested path's full content; unknown paths are reported
 * in `missing` so the tool can surface a structured `file_missing` error.
 */
export const getFilesByPaths = internalQuery({
  args: {
    artifactId: v.id('artifacts'),
    paths: v.array(v.string()),
    expectedOrganizationId: v.optional(v.string()),
    expectedThreadId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { artifactId, paths, expectedOrganizationId, expectedThreadId },
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
    const resolved = resolveArtifactFiles(artifact);
    // Prefer artifactFiles rows when present; fall back to resolved files.
    const tableRows: { path: string; content: string }[] = [];
    for await (const row of ctx.db
      .query('artifactFiles')
      .withIndex('by_artifact', (q) => q.eq('artifactId', artifactId))) {
      tableRows.push({ path: row.path, content: row.content });
    }
    const source = tableRows.length > 0 ? tableRows : resolved.files;
    const byPath = new Map<string, string>();
    for (const f of source) byPath.set(f.path, f.content);
    const found: { path: string; content: string }[] = [];
    const missing: string[] = [];
    for (const p of paths) {
      const content = byPath.get(p);
      if (content === undefined) {
        missing.push(p);
      } else {
        found.push({ path: p, content });
      }
    }
    return {
      artifactId,
      revision: artifact.revision,
      type: artifact.type,
      title: artifact.title,
      language: artifact.language,
      entryFile: resolved.entryFile,
      availablePaths: Array.from(byPath.keys()),
      files: found,
      missing,
    };
  },
});

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
