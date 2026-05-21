import { syncStreams, vStreamArgs } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { resolveArtifactFiles } from './resolve_files';

const MAX_LIST_BY_THREAD = 50;

/**
 * Metadata-only projection of an artifact row, returned by `listByThread`.
 * The full `content` / `streamingContent` / `streamingPatches` fields are
 * deliberately excluded — neither caller (ArtifactBar, MessageArtifactPills)
 * reads them, and including them shipped up to ~40 MB per Convex push for a
 * thread with many large artifacts.
 *
 * Detail views call `getById` for the full document.
 */
export interface ArtifactListItem {
  _id: Doc<'artifacts'>['_id'];
  _creationTime: number;
  type: Doc<'artifacts'>['type'];
  title: string;
  language?: string;
  revision: number;
  liveStreamMode?: Doc<'artifacts'>['liveStreamMode'];
  /** Number of files in the project. Derived from `files` or 1 for legacy. */
  fileCount: number;
  /** Entry-file path. Synthesized for legacy rows via {@link resolveArtifactFiles}. */
  entryFile: string;
  /** Aggregate byte length of file contents (entry file's content for legacy rows). */
  totalBytes: number;
  createdByMessageId: string;
  lastEditedByMessageId?: string;
  createdAt: number;
  updatedAt: number;
}

function projectListItem(row: Doc<'artifacts'>): ArtifactListItem {
  const resolved = resolveArtifactFiles(row);
  const totalBytes = resolved.files.reduce(
    (acc, f) => acc + f.content.length,
    0,
  );
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    type: row.type,
    title: row.title,
    language: row.language,
    revision: row.revision,
    liveStreamMode: row.liveStreamMode,
    fileCount: resolved.files.length,
    entryFile: resolved.entryFile,
    totalBytes,
    createdByMessageId: row.createdByMessageId,
    lastEditedByMessageId: row.lastEditedByMessageId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const getById = query({
  args: { artifactId: v.id('artifacts') },
  handler: async (ctx, { artifactId }): Promise<Doc<'artifacts'> | null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) return null;
    const metadata = await canAccessThread(
      ctx,
      artifact.threadId,
      authUser,
      artifact.organizationId,
    );
    if (!metadata || metadata.organizationId !== artifact.organizationId) {
      return null;
    }
    return artifact;
  },
});

/**
 * List the most recent artifacts for a thread, capped at MAX_LIST_BY_THREAD
 * (50). Returns metadata only — see `ArtifactListItem`. The previous
 * `paginationOpts` validator was misleading: only `numItems` was honoured and
 * the cursor was silently dropped, so threads with >50 artifacts truncated
 * older entries with no recovery path. We replace it with an explicit
 * `limit?: number` argument; if real pagination is needed it should be a
 * separate API surface with a proper cursor.
 */
export const listByThread = query({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { organizationId, threadId, limit },
  ): Promise<ArtifactListItem[]> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    const metadata = await canAccessThread(
      ctx,
      threadId,
      authUser,
      organizationId,
    );
    if (!metadata || metadata.organizationId !== organizationId) return [];

    const cap = Math.max(
      1,
      Math.min(limit ?? MAX_LIST_BY_THREAD, MAX_LIST_BY_THREAD),
    );
    const newestFirst = await ctx.db
      .query('artifacts')
      .withIndex('by_organizationId_and_thread', (q) =>
        q.eq('organizationId', organizationId).eq('threadId', threadId),
      )
      .order('desc')
      .take(cap);
    return newestFirst.toReversed().map(projectListItem);
  },
});

/**
 * Cursor-based subscription to the live tool-input-delta stream for an
 * artifact's create/edit invocation. Thin wrapper around the agent SDK's
 * `syncStreams` — we just authorize access to the artifact's thread and
 * forward the cursor request to the component. The returned `parts` carry
 * the same `{ type: 'tool-input-delta', toolCallId, inputTextDelta }`
 * shape the chat UI already consumes; the canvas pane filters down to its
 * artifact's `toolCallId` and decodes the JSON `content` value
 * client-side. See plan §3 (eventual-mixing-dawn.md).
 */
export const syncArtifactStream = query({
  args: {
    artifactId: v.id('artifacts'),
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, { artifactId, streamArgs }) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return undefined;
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) return undefined;
    const metadata = await canAccessThread(
      ctx,
      artifact.threadId,
      authUser,
      artifact.organizationId,
    );
    if (!metadata || metadata.organizationId !== artifact.organizationId) {
      return undefined;
    }
    if (metadata.status === 'deleted') return undefined;

    return await syncStreams(ctx, components.agent, {
      threadId: artifact.threadId,
      streamArgs,
      includeStatuses: ['streaming'],
    });
  },
});

/**
 * Shared shape of one per-file run projection — produced by both the
 * normal `projectExecutionRow` and the legacy `projectArtifactRowFallback`,
 * so callers (the `listRunsPerFile` query, its pure helper, the canvas
 * `RunResultPanel`) can treat both branches uniformly.
 */
export interface ArtifactRunFileProjection {
  executionId: Doc<'sandboxExecutions'>['_id'] | null;
  path: string;
  runStatus: Doc<'sandboxExecutions'>['status'] | undefined;
  runProgress: Doc<'artifacts'>['runProgress'] | undefined;
  runErrorCode: Doc<'sandboxExecutions'>['errorCode'] | undefined;
  runErrorMessage: Doc<'sandboxExecutions'>['errorMessage'] | undefined;
  runStdoutPreview: Doc<'sandboxExecutions'>['stdoutPreview'] | undefined;
  runStderrPreview: Doc<'sandboxExecutions'>['stderrPreview'] | undefined;
  runOutputFiles: Doc<'sandboxExecutions'>['outputFiles'] | undefined;
  runRevision: number | undefined;
  runExitCode: number | undefined;
}

/**
 * Project a `sandboxExecutions` row into the legacy `artifact.run*` shape
 * the canvas renderer consumes. `runProgress` is mirrored from the artifact
 * row ONLY when the execution is the currently-active one (the artifact
 * row's `runExecutionId` matches), so a finished run keeps its final
 * status without picking up a later run's progress chrome.
 */
function projectExecutionRow(
  artifact: Doc<'artifacts'>,
  row: Doc<'sandboxExecutions'>,
  path: string,
): ArtifactRunFileProjection {
  const isCurrentLatest =
    artifact.runExecutionId !== undefined &&
    artifact.runExecutionId === row._id;
  return {
    executionId: row._id,
    path,
    runStatus: row.status,
    runProgress: isCurrentLatest ? artifact.runProgress : undefined,
    runErrorCode: row.errorCode,
    runErrorMessage: row.errorMessage,
    runStdoutPreview: row.stdoutPreview,
    runStderrPreview: row.stderrPreview,
    runOutputFiles: row.outputFiles,
    runRevision: isCurrentLatest ? artifact.runRevision : undefined,
    runExitCode: row.exitCode,
  };
}

/**
 * Legacy fallback projection for single-file artifacts whose runs predate
 * the `sandboxExecutions.path` column — we read the run state off the
 * artifact row directly. Only reachable when the caller is asking about
 * the entry file (other paths can't be ambiguously inferred from the row).
 */
function projectArtifactRowFallback(
  artifact: Doc<'artifacts'>,
  path: string,
): ArtifactRunFileProjection {
  return {
    executionId: artifact.runExecutionId ?? null,
    path,
    runStatus: artifact.runStatus,
    runProgress: artifact.runProgress,
    runErrorCode: artifact.runErrorCode,
    runErrorMessage: artifact.runErrorMessage,
    runStdoutPreview: artifact.runStdoutPreview,
    runStderrPreview: artifact.runStderrPreview,
    runOutputFiles: artifact.runOutputFiles ?? [],
    runRevision: artifact.runRevision,
    runExitCode: artifact.runExitCode,
  };
}

/**
 * Pure helper extracted from `listRunsPerFile` for unit testability —
 * applies the latest-per-path collapse, ordering (entry file first,
 * declared order after), and projection. The Convex wrapper handles auth,
 * row fetching, and the index walk.
 *
 * `executionsNewestFirst` must already be sorted newest-first; rows are
 * traversed in that order and the first occurrence of each `path` wins.
 * Rows with a `path` not present in `declaredFiles` are dropped (the user
 * deleted that file from the project).
 */
export function selectRunsPerFile(
  artifact: Doc<'artifacts'>,
  executionsNewestFirst: Doc<'sandboxExecutions'>[],
  entryFile: string,
  declaredFiles: ReadonlyArray<string>,
): ArtifactRunFileProjection[] {
  const filePaths = new Set(declaredFiles);
  const latestByPath = new Map<string, Doc<'sandboxExecutions'>>();
  for (const row of executionsNewestFirst) {
    const rowPath = row.path;
    if (rowPath === undefined) continue;
    if (!filePaths.has(rowPath)) continue;
    if (latestByPath.has(rowPath)) continue;
    latestByPath.set(rowPath, row);
  }

  // Legacy fallback: no per-file rows at all but the artifact row carries
  // run state (pre-`path` column data) — synthesize a single entry-file
  // projection so the user still sees their last run.
  if (
    latestByPath.size === 0 &&
    artifact.runStatus !== undefined &&
    filePaths.has(entryFile)
  ) {
    return [projectArtifactRowFallback(artifact, entryFile)];
  }

  // Stable order: entry file first, then declared file order.
  const ordered: string[] = [];
  if (filePaths.has(entryFile)) ordered.push(entryFile);
  for (const path of declaredFiles) {
    if (path !== entryFile) ordered.push(path);
  }
  return ordered
    .map((path) => ({ path, row: latestByPath.get(path) }))
    .filter(
      (pair): pair is { path: string; row: Doc<'sandboxExecutions'> } =>
        pair.row !== undefined,
    )
    .map(({ path, row }) => projectExecutionRow(artifact, row, path));
}

/**
 * Per-file run projections for every file in `artifact.files[]` that has a
 * recorded execution row. Backs the canvas `RunResultPanel`, which displays
 * the entry file's run as a primary fixture and other files' runs as
 * collapsible secondaries — independent of the sidebar's active file.
 *
 * Ordering: entry file first if present, then the remaining files in
 * `files[]` declaration order. Files without any recorded execution row
 * are omitted (the panel stays quiet for files that have never run).
 *
 * For legacy single-file artifacts whose runs predate `sandboxExecutions.path`,
 * we synthesize a single entry-file row from the artifact's `run*` fields.
 */
export const listRunsPerFile = query({
  args: { artifactId: v.id('artifacts') },
  handler: async (ctx, { artifactId }) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) return [];
    const metadata = await canAccessThread(
      ctx,
      artifact.threadId,
      authUser,
      artifact.organizationId,
    );
    if (!metadata || metadata.organizationId !== artifact.organizationId) {
      return [];
    }

    const resolved = resolveArtifactFiles(artifact);
    const executions: Doc<'sandboxExecutions'>[] = [];
    for await (const row of ctx.db
      .query('sandboxExecutions')
      .withIndex('by_artifactId', (q) => q.eq('artifactId', artifactId))
      .order('desc')) {
      executions.push(row);
    }
    return selectRunsPerFile(
      artifact,
      executions,
      resolved.entryFile,
      resolved.files.map((f) => f.path),
    );
  },
});
