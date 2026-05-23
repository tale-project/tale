/**
 * Handler bodies + validators for runnable-artifact run-state mutations:
 * setArtifactRunConfig, initArtifactRun, appendArtifactRunOutput,
 * patchArtifactRunProgress, finalizeArtifactRun (+ the pure-function
 * `applyFinalizeArtifactRun` shared with the sandbox internal_mutations).
 */

import { ConvexError, type Infer, v } from 'convex/values';

import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { isRunnableArtifactType } from '../../agent_tools/artifacts/shared';
import {
  SANDBOX_STDERR_PREVIEW_MAX,
  SANDBOX_STDOUT_PREVIEW_MAX,
} from '../../sandbox/schema';
import {
  sandboxRunProgressValidator,
  sandboxTerminalStatuses,
} from '../../sandbox/wire';
import {
  artifactRunErrorCodeValidator,
  artifactRunOutputFileValidator,
  artifactRunStatusValidator,
} from '../schema';

type ArtifactRunErrorCode = Infer<typeof artifactRunErrorCodeValidator>;
type ArtifactRunOutputFile = Infer<typeof artifactRunOutputFileValidator>;

// =============================================================================
// setArtifactRunConfig — persist packages / runOptions on the artifact row
// =============================================================================

export const setArtifactRunConfigArgs = {
  artifactId: v.id('artifacts'),
  runPackages: v.array(v.string()),
  /**
   * Optional grouped form persisted alongside the legacy flat list.
   * Polyglot runs read from here; single-runtime runs fall back to
   * `runPackages` when this is absent.
   */
  runPackagesByLang: v.optional(
    v.object({
      python: v.optional(v.array(v.string())),
      node: v.optional(v.array(v.string())),
    }),
  ),
  runOptions: v.optional(
    v.object({
      allowSdist: v.optional(v.boolean()),
      allowInstallScripts: v.optional(v.boolean()),
    }),
  ),
} as const;

export const setArtifactRunConfigReturns = v.null();

export async function setArtifactRunConfigHandler(
  ctx: MutationCtx,
  args: {
    artifactId: Id<'artifacts'>;
    runPackages: string[];
    runPackagesByLang?: { python?: string[]; node?: string[] };
    runOptions?: { allowSdist?: boolean; allowInstallScripts?: boolean };
  },
) {
  const row = await ctx.db.get(args.artifactId);
  if (!row) return null;
  if (!isRunnableArtifactType(row.type)) return null;
  await ctx.db.patch(args.artifactId, {
    runPackages: args.runPackages,
    ...(args.runPackagesByLang !== undefined && {
      runPackagesByLang: args.runPackagesByLang,
    }),
    ...(args.runOptions !== undefined && { runOptions: args.runOptions }),
  });
  return null;
}

// =============================================================================
// addArtifactPackages — union packages_add into the persistent runPackages
//
// Used by the `artifact_packages_add` tool and the `artifact_file_create` /
// `artifact_file_update` tools' optional `packages_add` arg so the LLM can declare
// new dependencies inline with the edit that introduces them. Dedupe is
// case-sensitive (matches pip/npm's own resolution rules). Existing
// entries are never removed — `artifact_create` is the way to start
// fresh.
// =============================================================================

export const addArtifactPackagesArgs = {
  artifactId: v.id('artifacts'),
  /**
   * Flat-list union into `runPackages`. Kept for callers that don't
   * know which runtime their specs belong to (legacy single-runtime
   * artifacts). Polyglot callers should use {@link packagesAddByLang}
   * instead.
   */
  packagesAdd: v.array(v.string()),
  /**
   * Grouped union into `runPackagesByLang`. Either bucket may be
   * omitted. Both `packagesAdd` and `packagesAddByLang` can be sent in
   * the same call — they're applied independently.
   */
  packagesAddByLang: v.optional(
    v.object({
      python: v.optional(v.array(v.string())),
      node: v.optional(v.array(v.string())),
    }),
  ),
} as const;

export const addArtifactPackagesReturns = v.object({
  runPackages: v.array(v.string()),
  added: v.array(v.string()),
  runPackagesByLang: v.optional(
    v.object({
      python: v.optional(v.array(v.string())),
      node: v.optional(v.array(v.string())),
    }),
  ),
  addedByLang: v.optional(
    v.object({
      python: v.optional(v.array(v.string())),
      node: v.optional(v.array(v.string())),
    }),
  ),
});

function unionPackages(
  existing: readonly string[],
  incoming: readonly string[],
): { next: string[]; added: string[] } {
  const seen = new Set(existing);
  const added: string[] = [];
  for (const pkg of incoming) {
    if (pkg.length === 0) continue;
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    added.push(pkg);
  }
  return {
    next: added.length === 0 ? [...existing] : [...existing, ...added],
    added,
  };
}

export async function addArtifactPackagesHandler(
  ctx: MutationCtx,
  args: {
    artifactId: Id<'artifacts'>;
    packagesAdd: string[];
    packagesAddByLang?: { python?: string[]; node?: string[] };
  },
) {
  const row = await ctx.db.get(args.artifactId);
  if (!row) return { runPackages: [], added: [] };
  if (!isRunnableArtifactType(row.type)) {
    return { runPackages: row.runPackages ?? [], added: [] };
  }
  const flatUnion = unionPackages(row.runPackages ?? [], args.packagesAdd);
  const stored = row.runPackagesByLang ?? {};
  const pyUnion = unionPackages(
    stored.python ?? [],
    args.packagesAddByLang?.python ?? [],
  );
  const nodeUnion = unionPackages(
    stored.node ?? [],
    args.packagesAddByLang?.node ?? [],
  );
  const groupedChanged = pyUnion.added.length > 0 || nodeUnion.added.length > 0;
  const flatChanged = flatUnion.added.length > 0;
  if (!flatChanged && !groupedChanged) {
    return {
      runPackages: flatUnion.next,
      added: [],
      ...(stored.python !== undefined || stored.node !== undefined
        ? {
            runPackagesByLang: {
              ...(stored.python !== undefined && { python: stored.python }),
              ...(stored.node !== undefined && { node: stored.node }),
            },
          }
        : {}),
    };
  }
  const patch: Record<string, unknown> = {};
  if (flatChanged) patch.runPackages = flatUnion.next;
  if (groupedChanged) {
    const nextGrouped: { python?: string[]; node?: string[] } = {};
    if (pyUnion.next.length > 0) nextGrouped.python = pyUnion.next;
    if (nodeUnion.next.length > 0) nextGrouped.node = nodeUnion.next;
    patch.runPackagesByLang = nextGrouped;
  }
  await ctx.db.patch(args.artifactId, patch);
  return {
    runPackages: flatUnion.next,
    added: flatUnion.added,
    ...((pyUnion.next.length > 0 || nodeUnion.next.length > 0) && {
      runPackagesByLang: {
        ...(pyUnion.next.length > 0 && { python: pyUnion.next }),
        ...(nodeUnion.next.length > 0 && { node: nodeUnion.next }),
      },
    }),
    ...((pyUnion.added.length > 0 || nodeUnion.added.length > 0) && {
      addedByLang: {
        ...(pyUnion.added.length > 0 && { python: pyUnion.added }),
        ...(nodeUnion.added.length > 0 && { node: nodeUnion.added }),
      },
    }),
  };
}

// =============================================================================
// initArtifactRun — clear run-progress fields at the start of a new run
//
// `runOutputFiles` intentionally NOT cleared here — keep the prior
// successful run's outputs available for pre-staging during this run.
// Successful finalize will replace; failed/empty finalize preserves.
// =============================================================================

export const initArtifactRunArgs = {
  artifactId: v.id('artifacts'),
} as const;

export const initArtifactRunReturns = v.null();

export async function initArtifactRunHandler(
  ctx: MutationCtx,
  args: { artifactId: Id<'artifacts'> },
) {
  const row = await ctx.db.get(args.artifactId);
  if (!row) return null;
  if (!isRunnableArtifactType(row.type)) return null;
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
    runRevision: row.revision,
    runCompletedAt: undefined,
    runExitCode: undefined,
    runErrorCode: undefined,
    runErrorMessage: undefined,
    runStdoutPreview: undefined,
    runStderrPreview: undefined,
    runStdoutStorageId: undefined,
    runStderrStorageId: undefined,
    runExecutionId: undefined,
  });
  return null;
}

// =============================================================================
// appendArtifactRunOutput — incremental tail of the running stdout/stderr
//
// Caps + ordering:
//  - Each preview field caps at SANDBOX_{STDOUT,STDERR}_PREVIEW_MAX = 16 KB.
//    Bytes past the cap are silently dropped — the canonical preview written
//    at `finalizeArtifactRun` is the first 16 KB of the buffer, so matching
//    semantics here avoids a content-switch the user would notice at
//    terminal time.
//  - Mutation no-ops on terminal `runStatus` (a late-arriving delta from a
//    canceled run can't overwrite the finalize-time preview).
//  - Mutation no-ops when `args.executionId !== row.runExecutionId` (a
//    stale delta from a previous run can't pollute a freshly-started one).
// =============================================================================

export const appendArtifactRunOutputArgs = {
  artifactId: v.id('artifacts'),
  executionId: v.id('sandboxExecutions'),
  stdoutDelta: v.optional(v.string()),
  stderrDelta: v.optional(v.string()),
} as const;

export const appendArtifactRunOutputReturns = v.null();

export async function appendArtifactRunOutputHandler(
  ctx: MutationCtx,
  args: {
    artifactId: Id<'artifacts'>;
    executionId: Id<'sandboxExecutions'>;
    stdoutDelta?: string;
    stderrDelta?: string;
  },
) {
  const row = await ctx.db.get(args.artifactId);
  if (!row) return null;
  if (!isRunnableArtifactType(row.type)) return null;
  if (
    row.runStatus !== undefined &&
    sandboxTerminalStatuses.has(row.runStatus)
  ) {
    return null;
  }
  if (
    row.runExecutionId !== undefined &&
    row.runExecutionId !== args.executionId
  ) {
    return null;
  }
  const patch: Record<string, unknown> = {};
  if (args.stdoutDelta && args.stdoutDelta.length > 0) {
    const current = row.runStdoutPreview ?? '';
    if (current.length < SANDBOX_STDOUT_PREVIEW_MAX) {
      const headroom = SANDBOX_STDOUT_PREVIEW_MAX - current.length;
      const slice = args.stdoutDelta.slice(0, headroom);
      if (slice.length > 0) patch.runStdoutPreview = current + slice;
    }
  }
  if (args.stderrDelta && args.stderrDelta.length > 0) {
    const current = row.runStderrPreview ?? '';
    if (current.length < SANDBOX_STDERR_PREVIEW_MAX) {
      const headroom = SANDBOX_STDERR_PREVIEW_MAX - current.length;
      const slice = args.stderrDelta.slice(0, headroom);
      if (slice.length > 0) patch.runStderrPreview = current + slice;
    }
  }
  if (Object.keys(patch).length === 0) return null;
  await ctx.db.patch(args.artifactId, patch);
  return null;
}

// =============================================================================
// patchArtifactRunProgress — structured phase updates from the spawner
// =============================================================================

export const patchArtifactRunProgressArgs = {
  artifactId: v.id('artifacts'),
  runStatus: v.optional(artifactRunStatusValidator),
  runProgress: v.optional(sandboxRunProgressValidator),
  runExecutionId: v.optional(v.id('sandboxExecutions')),
} as const;

export const patchArtifactRunProgressReturns = v.null();

export async function patchArtifactRunProgressHandler(
  ctx: MutationCtx,
  args: {
    artifactId: Id<'artifacts'>;
    runStatus?: Infer<typeof artifactRunStatusValidator>;
    runProgress?: Infer<typeof sandboxRunProgressValidator>;
    runExecutionId?: Id<'sandboxExecutions'>;
  },
) {
  const row = await ctx.db.get(args.artifactId);
  if (!row) return null;
  if (!isRunnableArtifactType(row.type)) return null;
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
}

// =============================================================================
// applyFinalizeArtifactRun — pure helper shared with sandbox internal_mutations
//
// `runOutputFiles` is only written when the harvest produced at least one
// file. A run with an empty harvest — regardless of run status — must NOT
// wipe the prior run's outputs. The footgun this guards against: a
// `qa.py`-only run that exits 0 with no /workspace/output writes counts
// as `completed`; if it overwrites the legacy `runOutputFiles` field
// with `[]`, the next `artifact_run`'s pre-stage falls back to that
// empty list and the user hits `FileNotFoundError` on a file that
// demonstrably existed before. The `artifactRunFiles` table is append-
// only and not affected by this rule.
// =============================================================================

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
    runExecutionId?: Id<'sandboxExecutions'>;
  },
): Promise<void> {
  const row = await ctx.db.get(args.artifactId);
  if (!row) return;
  if (!isRunnableArtifactType(row.type)) return;
  if (
    row.runStatus !== undefined &&
    sandboxTerminalStatuses.has(row.runStatus)
  ) {
    console.warn(
      `[finalizeArtifactRun] no-op: artifact ${args.artifactId} already terminal as ${row.runStatus}; dropping incoming ${args.runStatus}`,
    );
    return;
  }
  const completedAt = Date.now();
  await ctx.db.patch(args.artifactId, {
    runStatus: args.runStatus,
    runProgress: undefined,
    runCompletedAt: completedAt,
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
    ...(args.runOutputFiles.length > 0 && {
      runOutputFiles: args.runOutputFiles,
    }),
    ...(args.runExecutionId !== undefined && {
      runExecutionId: args.runExecutionId,
    }),
  });

  // Dual-write to the new artifactRuns / artifactRunFiles tables. The
  // legacy artifacts.runOutputFiles write above remains as a fallback
  // source per [feedback_deprecate_dont_delete_schema_fields]; later
  // phases will switch readers and stop writing the old field. Append-
  // only — every finalize creates a new artifactRuns row (including
  // failed/cancelled runs, so the LLM can introspect history).
  const startedAt = row.runStartedAt ?? completedAt;
  const runId = await ctx.db.insert('artifactRuns', {
    artifactId: args.artifactId,
    status: args.runStatus,
    ...(args.runExitCode !== undefined && { exitCode: args.runExitCode }),
    ...(args.runErrorCode !== undefined && { errorCode: args.runErrorCode }),
    ...(args.runErrorMessage !== undefined && {
      errorMessage: args.runErrorMessage,
    }),
    startedAt,
    endedAt: completedAt,
    revision: row.runRevision ?? row.revision,
    ...(args.runExecutionId !== undefined && {
      executionId: args.runExecutionId,
    }),
  });
  for (const f of args.runOutputFiles) {
    if (f.storageId === undefined) continue;
    await ctx.db.insert('artifactRunFiles', {
      runId,
      artifactId: args.artifactId,
      name: f.name,
      storageId: f.storageId,
      size: f.size,
      ...(f.contentType !== undefined && { contentType: f.contentType }),
      createdAt: completedAt,
    });
  }

  // Upsert into `artifactOutputs` — the cumulative workspace-state manifest
  // that backs pre-stage on the next run. Keyed by (artifactId, name);
  // same-name files patch in place (newest wins), new names accumulate.
  // Empty harvests don't touch the manifest, so a no-op run never wipes
  // earlier output. This is the single source of truth that replaces the
  // "latest-run walk-back" model — multi-run histories with different
  // filenames no longer lose older files.
  for (const f of args.runOutputFiles) {
    if (f.storageId === undefined) continue;
    const existing = await ctx.db
      .query('artifactOutputs')
      .withIndex('by_artifact_name', (q) =>
        q.eq('artifactId', args.artifactId).eq('name', f.name),
      )
      .unique();
    const patch = {
      storageId: f.storageId,
      size: f.size,
      ...(f.contentType !== undefined && { contentType: f.contentType }),
      ...(f.sha256 !== undefined && { sha256: f.sha256 }),
      producedByRunId: runId,
      updatedAt: completedAt,
    };
    if (existing === null) {
      await ctx.db.insert('artifactOutputs', {
        artifactId: args.artifactId,
        name: f.name,
        ...patch,
      });
    } else {
      await ctx.db.patch(existing._id, patch);
    }
  }
}

export const finalizeArtifactRunArgs = {
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
} as const;

export const finalizeArtifactRunReturns = v.null();

export async function finalizeArtifactRunHandler(
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
    runExecutionId?: Id<'sandboxExecutions'>;
  },
) {
  await applyFinalizeArtifactRun(ctx, args);
  return null;
}

// =============================================================================
// deriveOutputManifestFromHistory — lazy migration from artifactRunFiles
//
// Idempotent. Builds the cumulative `artifactOutputs` manifest for an
// artifact by walking `artifactRunFiles` newest-first and reducing
// (name → most-recent file). Used by `getLatestRunOutputs` on the
// FIRST pre-stage read for an artifact created before the manifest
// existed; subsequent runs maintain the manifest via the upsert in
// `applyFinalizeArtifactRun`.
//
// `sha256` is left undefined on legacy entries (the spawner-side hash
// wasn't computed at the time those rows landed). The pre-stage
// attestation treats no-sha256 entries as "presence only" — a successful
// download by name is enough; byte-exact diff is only enforced once the
// manifest has been refreshed by a fresh harvest.
// =============================================================================

export const deriveOutputManifestFromHistoryArgs = {
  artifactId: v.id('artifacts'),
} as const;

export const deriveOutputManifestFromHistoryReturns = v.object({
  inserted: v.number(),
  alreadyPresent: v.boolean(),
});

export async function deriveOutputManifestFromHistoryHandler(
  ctx: MutationCtx,
  args: { artifactId: Id<'artifacts'> },
): Promise<{ inserted: number; alreadyPresent: boolean }> {
  // Idempotency check — if any manifest row exists for this artifact,
  // assume derivation already happened and return early. The merge-on-
  // finalize path keeps it current from here on.
  const existing = await ctx.db
    .query('artifactOutputs')
    .withIndex('by_artifact', (q) => q.eq('artifactId', args.artifactId))
    .first();
  if (existing !== null) {
    return { inserted: 0, alreadyPresent: true };
  }

  // Walk artifactRunFiles indexed by artifact, reducing newest-name-wins.
  // `_creationTime` desc gives us newest first; the first occurrence of
  // each `name` is the winner. We resolve the producing run id by
  // reading the `runId` field already present on the row.
  const byName = new Map<
    string,
    {
      runId: Id<'artifactRuns'>;
      storageId: Id<'_storage'>;
      size: number;
      contentType?: string;
      createdAt: number;
    }
  >();
  for await (const row of ctx.db
    .query('artifactRunFiles')
    .withIndex('by_artifact', (q) => q.eq('artifactId', args.artifactId))
    .order('desc')) {
    if (byName.has(row.name)) continue;
    byName.set(row.name, {
      runId: row.runId,
      storageId: row.storageId,
      size: row.size,
      ...(row.contentType !== undefined && { contentType: row.contentType }),
      createdAt: row.createdAt,
    });
  }

  const now = Date.now();
  let inserted = 0;
  for (const [name, info] of byName) {
    await ctx.db.insert('artifactOutputs', {
      artifactId: args.artifactId,
      name,
      storageId: info.storageId,
      size: info.size,
      ...(info.contentType !== undefined && { contentType: info.contentType }),
      producedByRunId: info.runId,
      updatedAt: now,
    });
    inserted += 1;
  }

  return { inserted, alreadyPresent: false };
}
