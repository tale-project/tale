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
 * Returns the artifact's CUMULATIVE output manifest for pre-staging into the
 * next sandbox run's `/workspace/output/`. Each `(artifactId, name)` survives
 * across runs — empty runs don't wipe earlier files, and a later run that
 * produces a different filename doesn't shadow the earlier one.
 *
 * Source precedence (highest first):
 *   1. `artifactOutputs` table — cumulative manifest, maintained by
 *      `applyFinalizeArtifactRun` upserts. O(1) per artifact.
 *   2. Newest-name-wins reduction across `artifactRunFiles` — for artifacts
 *      that predate the manifest. Walks all runs newest-first, builds a
 *      `Map<name, file>` taking the first occurrence per name. The caller
 *      (action) is expected to follow up with `deriveOutputManifestFromHistory`
 *      so subsequent reads land in source 1.
 *   3. Legacy `artifacts.runOutputFiles` field — pre-`artifactRunFiles` rows
 *      (kept for backward compat per [feedback_deprecate_dont_delete_schema_fields]).
 *
 * Pre-stage source selection:
 *   - omitted `fromRun` (or `"latest"`): cumulative manifest as described above.
 *   - explicit runId string: pin to that exact run's files via
 *     `artifactRunFiles` (status-agnostic). Bypasses the cumulative model
 *     because the LLM is explicitly asking for "the state run X produced"
 *     rather than the artifact's accumulated workspace.
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
        sha256: v.optional(v.string()),
      }),
    ),
    source: v.union(
      v.literal('artifact_outputs'),
      v.literal('artifact_run_files'),
      v.literal('legacy_artifact_field'),
      v.literal('none'),
    ),
    /**
     * True when the cumulative manifest table is empty for this artifact
     * but a fallback source (`artifact_run_files` or `legacy_artifact_field`)
     * supplied the data. The caller should follow up with
     * `deriveOutputManifestFromHistory` so the next read is O(1).
     */
    needsManifestDerive: v.boolean(),
  }),
  handler: async (ctx, { artifactId, expectedOrganizationId, fromRun }) => {
    type PriorOutputFile = {
      name: string;
      storageId: import('../_generated/dataModel').Id<'_storage'>;
      size: number;
      contentType?: string;
      sha256?: string;
    };
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) {
      return { files: [], source: 'none' as const, needsManifestDerive: false };
    }
    if (
      expectedOrganizationId !== undefined &&
      artifact.organizationId !== expectedOrganizationId
    ) {
      return { files: [], source: 'none' as const, needsManifestDerive: false };
    }

    // 1. Explicit `from_run` pin — caller named a specific runId. Returns
    //    that run's `artifactRunFiles` exactly (status-agnostic, no
    //    cumulative reduce). Pin is a positive lever ("I want the state
    //    run X produced"), so we deliberately bypass the manifest path.
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
          needsManifestDerive: false,
        };
      }
    }

    // 2. Cumulative manifest (preferred). One index scan, no walk-back.
    const manifestFiles: Array<{
      name: string;
      storageId: import('../_generated/dataModel').Id<'_storage'>;
      size: number;
      contentType?: string;
      sha256?: string;
    }> = [];
    for await (const row of ctx.db
      .query('artifactOutputs')
      .withIndex('by_artifact', (q) => q.eq('artifactId', artifactId))) {
      manifestFiles.push({
        name: row.name,
        storageId: row.storageId,
        size: row.size,
        ...(row.contentType !== undefined && { contentType: row.contentType }),
        ...(row.sha256 !== undefined && { sha256: row.sha256 }),
      });
    }
    if (manifestFiles.length > 0) {
      return {
        files: manifestFiles,
        source: 'artifact_outputs' as const,
        needsManifestDerive: false,
      };
    }

    // 3. Pre-manifest fallback: walk `artifactRunFiles` newest-first and
    //    build a cumulative `Map<name, file>` (first occurrence wins).
    //    This already fixes the "newest-shadows-older" architectural
    //    defect even before the artifact's manifest gets derived. The
    //    caller is expected to follow up with the derive mutation so the
    //    next read lands in branch 2 above.
    //
    //    Status-agnostic by design — `artifactRunFiles` is append-only and
    //    only carries files that survived harvest + storage upload, so the
    //    row's presence is the "this file was really produced" signal.
    const byName = new Map<
      string,
      {
        storageId: import('../_generated/dataModel').Id<'_storage'>;
        size: number;
        contentType?: string;
      }
    >();
    for await (const row of ctx.db
      .query('artifactRunFiles')
      .withIndex('by_artifact', (q) => q.eq('artifactId', artifactId))
      .order('desc')) {
      if (byName.has(row.name)) continue;
      byName.set(row.name, {
        storageId: row.storageId,
        size: row.size,
        ...(row.contentType !== undefined && { contentType: row.contentType }),
      });
    }
    if (byName.size > 0) {
      const files = Array.from(byName, ([name, info]) => ({
        name,
        storageId: info.storageId,
        size: info.size,
        ...(info.contentType !== undefined && {
          contentType: info.contentType,
        }),
      }));
      return {
        files,
        source: 'artifact_run_files' as const,
        needsManifestDerive: true,
      };
    }

    // 4. Final fallback: legacy artifacts.runOutputFiles (pre-table data).
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
      // Legacy field can't be derived into manifest from a query — the
      // action's lazy-derive path explicitly only walks artifactRunFiles
      // (the legacy field has no producedByRunId reference). So this
      // flag stays false here; the next harvest will populate the
      // manifest naturally via applyFinalizeArtifactRun.
      needsManifestDerive: false,
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
