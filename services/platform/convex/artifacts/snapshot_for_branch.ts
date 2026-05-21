import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { mirrorLegacyContent, resolveArtifactFiles } from './resolve_files';

/**
 * Snapshot a single artifact from a parent thread into a freshly-forked
 * branch thread. Called by `createBranchThread` while copying messages.
 *
 * The caller decides which revision to snapshot via `snapshotRevision` AND
 * supplies the file state captured at that revision (`revisionFiles` +
 * `revisionEntryFile`, falling back to `revisionContent` for legacy
 * content-only rows). Using the source row's CURRENT files would mix in
 * out-of-scope edits made on the parent after the fork point — exactly the
 * bug the `create_branch_thread_artifacts` "later edits out of scope" test
 * pins down. When no revision-level snapshot is supplied we fall back to
 * the source row's current state (used by callers that branch from a
 * single-revision artifact, where current === in-scope).
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
    /** Files snapshot captured at `snapshotRevision` (Phase A+ rows). */
    revisionFiles?: ReadonlyArray<{ path: string; content: string }>;
    /** Entry-file pointer at `snapshotRevision`. */
    revisionEntryFile?: string;
    /** Legacy single-file content at `snapshotRevision` (Phase A rows). */
    revisionContent?: string;
  },
): Promise<{ artifactId: Doc<'artifacts'>['_id'] }> {
  const { source } = args;
  const sourceResolved = resolveArtifactFiles(source);
  let files: Array<{ path: string; content: string }>;
  let entryFile: string;
  if (args.revisionFiles !== undefined && args.revisionFiles.length > 0) {
    files = args.revisionFiles.map((f) => ({
      path: f.path,
      content: f.content,
    }));
    entryFile = args.revisionEntryFile ?? sourceResolved.entryFile;
  } else if (args.revisionContent !== undefined) {
    // Legacy `content`-only revision: synthesize a single-file artifact at
    // the entry path captured at that revision (or the current entry as a
    // last resort — only the entry pointer can drift, files cannot, since
    // legacy rows only had one file).
    entryFile = args.revisionEntryFile ?? sourceResolved.entryFile;
    files = [{ path: entryFile, content: args.revisionContent }];
  } else {
    // No revision-level snapshot supplied — current state is in-scope.
    files = sourceResolved.files.map((f) => ({
      path: f.path,
      content: f.content,
    }));
    entryFile = sourceResolved.entryFile;
  }
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
