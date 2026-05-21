import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { mirrorLegacyContent, resolveArtifactFiles } from './resolve_files';

/**
 * Snapshot a single artifact from a parent thread into a freshly-forked
 * branch thread. Called by `createBranchThread` while copying messages.
 *
 * The caller decides which revision to snapshot via `snapshotRevision`. We
 * use the SOURCE's current resolved files/entryFile (which already accounts
 * for legacy `content`-only rows via `resolveArtifactFiles`).
 *
 * Behaviour:
 *   - Inserts a new `artifacts` row scoped to `targetThreadId`.
 *   - Preserves `snapshotRevision` as the row's `revision` so the user
 *     sees continuous version labels.
 *   - Copies the full `files[]` map and `entryFile`. Also mirrors entry
 *     content to legacy `content` for rollback safety during Phase A.
 *   - Inserts one `artifactRevisions` row with `editKind: 'branch'`.
 */
export async function snapshotArtifactForBranch(
  ctx: MutationCtx,
  args: {
    source: Doc<'artifacts'>;
    snapshotRevision: number;
    targetThreadId: string;
    mappedCreatedByMessageId: string;
    mappedLastEditedByMessageId?: string;
  },
): Promise<{ artifactId: Doc<'artifacts'>['_id'] }> {
  const { source } = args;
  const resolved = resolveArtifactFiles(source);
  const files = resolved.files.map((f) => ({
    path: f.path,
    content: f.content,
  }));
  const entryFile = resolved.entryFile;
  const legacyContent = mirrorLegacyContent(files, entryFile);
  const now = Date.now();
  const artifactId = await ctx.db.insert('artifacts', {
    organizationId: source.organizationId,
    threadId: args.targetThreadId,
    type: source.type,
    title: source.title,
    language: source.language,
    files,
    entryFile,
    content: legacyContent,
    revision: args.snapshotRevision,
    createdByMessageId: args.mappedCreatedByMessageId,
    lastEditedByMessageId: args.mappedLastEditedByMessageId,
    createdAt: now,
    updatedAt: now,
    // Streaming fields intentionally omitted — branch starts settled.
  });
  await ctx.db.insert('artifactRevisions', {
    artifactId,
    revision: args.snapshotRevision,
    content: legacyContent,
    files,
    entryFile,
    editedByMessageId:
      args.mappedLastEditedByMessageId ?? args.mappedCreatedByMessageId,
    editKind: 'branch',
    createdAt: now,
  });
  return { artifactId };
}
