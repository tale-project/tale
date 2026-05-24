/**
 * Shared helpers + constants for the artifact mutation handlers.
 *
 * Lives next to the handler modules so the per-mutation files can stay free
 * of helper bodies; the `internal_mutations.ts` shell file re-exports the
 * public-facing symbols (`MAX_ARTIFACT_BYTES`, `assertAggregateSize`) so
 * existing imports continue to resolve.
 */

import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import {
  MAX_FILES_PER_ARTIFACT,
  findDuplicatePath,
  validatePath,
} from '../../agent_tools/artifacts/shared';
import { aggregateFileBytes } from '../resolve_files';

export const STALE_STREAM_THRESHOLD_MS = 60_000;

/**
 * Hard cap on an artifact's TOTAL content (sum of all `files[].content` bytes).
 * Convex's per-document limit is 1 MiB; we cap below that so a single mutation
 * that also writes a revision row (full files snapshot) stays under the limit,
 * and so an LLM rewrite that runs away yields a clean `too_large` error.
 */
export const MAX_ARTIFACT_BYTES = 800_000;

/** Lazy-GC retention: keep the N most recent revisions per artifact. */
export const REVISIONS_RETENTION = 20;

/**
 * @deprecated — single-file size check. Kept for backward-compat with
 * existing callers; new code should use {@link assertAggregateSize}.
 */
export function assertContentSize(content: string): void {
  const size = new TextEncoder().encode(content).byteLength;
  if (size > MAX_ARTIFACT_BYTES) {
    throw new ConvexError({
      code: 'too_large',
      message: `Artifact content is ${size} bytes; max ${MAX_ARTIFACT_BYTES}.`,
    });
  }
}

export function assertAggregateSize(
  files: readonly { readonly content: string }[],
): void {
  const size = aggregateFileBytes(files);
  if (size > MAX_ARTIFACT_BYTES) {
    throw new ConvexError({
      code: 'too_large',
      message: `Artifact total content is ${size} bytes across ${files.length} files; max ${MAX_ARTIFACT_BYTES}.`,
    });
  }
}

/**
 * Central source of truth for the field set that "ends a stream." Every
 * settle / abort / cleanup path patches these to `undefined` together so
 * the canvas pane reliably transitions out of the live state.
 */
export function clearStreamingFlags(): Partial<Doc<'artifacts'>> {
  return {
    streamingContent: undefined,
    streamingPatches: undefined,
    streamingPath: undefined,
    liveStreamMode: undefined,
    liveStreamStartedAt: undefined,
    toolCallId: undefined,
  };
}

/**
 * Lazy GC of revision history. Called at the tail of every revision-emitting
 * mutation. Keeps the {@link REVISIONS_RETENTION} most recent revisions and
 * deletes older ones opportunistically. No cron — per memory
 * feedback_lazy_cleanup_over_cron.
 */
export async function trimRevisionHistory(
  ctx: MutationCtx,
  artifactId: Id<'artifacts'>,
): Promise<void> {
  const rows: { _id: Id<'artifactRevisions'>; revision: number }[] = [];
  for await (const row of ctx.db
    .query('artifactRevisions')
    .withIndex('by_artifact', (q) => q.eq('artifactId', artifactId))
    .order('desc')) {
    rows.push({ _id: row._id, revision: row.revision });
    if (rows.length > REVISIONS_RETENTION * 2) break; // safety bound
  }
  if (rows.length <= REVISIONS_RETENTION) return;
  for (let i = REVISIONS_RETENTION; i < rows.length; i += 1) {
    await ctx.db.delete(rows[i]._id);
  }
}

/**
 * Reconcile the `artifactFiles` table with the artifact's authoritative
 * `files[]` array after a settle. The artifact-row write is the source of
 * truth for the in-flight refactor (plan llm-majestic-hamming.md →
 * artifact-breezy-codd.md); this helper keeps the per-file table in sync so
 * canvas reads from `artifactFiles` see the same view.
 *
 * Insert rows for new paths, patch content/updatedAt for changed paths,
 * delete rows whose path is no longer in `files`. `streamingWriteToolCallId`
 * is cleared on every settle — the stream that wrote this revision is done.
 */
export async function syncArtifactFiles(
  ctx: MutationCtx,
  artifactId: Id<'artifacts'>,
  files: readonly { readonly path: string; readonly content: string }[],
  now: number,
): Promise<void> {
  const existing: Doc<'artifactFiles'>[] = [];
  for await (const row of ctx.db
    .query('artifactFiles')
    .withIndex('by_artifact', (q) => q.eq('artifactId', artifactId))) {
    existing.push(row);
  }
  const targetPaths = new Set(files.map((f) => f.path));
  const existingByPath = new Map<string, Doc<'artifactFiles'>>();
  for (const row of existing) existingByPath.set(row.path, row);

  for (const f of files) {
    const prior = existingByPath.get(f.path);
    if (prior === undefined) {
      await ctx.db.insert('artifactFiles', {
        artifactId,
        path: f.path,
        content: f.content,
        createdAt: now,
        updatedAt: now,
      });
    } else if (
      prior.content !== f.content ||
      prior.streamingWriteToolCallId !== undefined
    ) {
      await ctx.db.patch(prior._id, {
        content: f.content,
        streamingWriteToolCallId: undefined,
        updatedAt: now,
      });
    }
  }
  for (const row of existing) {
    if (!targetPaths.has(row.path)) {
      await ctx.db.delete(row._id);
    }
  }
}

/**
 * Validate + canonicalize the file list before any write. Throws on path
 * violations, oversize, duplicate paths, or empty files array. Returns the
 * NFC-normalized file list.
 */
export function validateFiles(
  input: readonly { readonly path: string; readonly content: string }[],
): { readonly path: string; readonly content: string }[] {
  if (input.length === 0) {
    throw new ConvexError({
      code: 'empty_project',
      message: 'Artifact must contain at least one file.',
    });
  }
  if (input.length > MAX_FILES_PER_ARTIFACT) {
    throw new ConvexError({
      code: 'too_many_files',
      message: `Artifact has ${input.length} files; max ${MAX_FILES_PER_ARTIFACT}.`,
    });
  }
  const normalized = input.map((f) => ({
    path: validatePath(f.path),
    content: f.content,
  }));
  const dup = findDuplicatePath(normalized);
  if (dup !== null) {
    throw new ConvexError({
      code: 'duplicate_path',
      message: `Duplicate file path "${dup}" (paths are compared case-insensitively).`,
    });
  }
  assertAggregateSize(normalized);
  return normalized;
}
