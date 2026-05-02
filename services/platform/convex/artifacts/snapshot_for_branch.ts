import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/**
 * Snapshot a single artifact from a parent thread into a freshly-forked
 * branch thread. Called by `createBranchThread` while copying messages.
 *
 * The caller decides which revision to snapshot (the latest in-scope one,
 * walked from `artifactRevisions` so the branch sees the artifact as it
 * stood at the fork point — not the parent's current state, which may
 * include post-fork edits the branch shouldn't inherit).
 *
 * Behaviour:
 *   - Inserts a new `artifacts` row scoped to `targetThreadId`.
 *   - Preserves `snapshotRevision` as the row's `revision` so the user
 *     sees continuous version labels (e.g. "v26" in both branches);
 *     branching is a workspace fork, not a fresh start.
 *   - Always uses settled `snapshotContent` — never `streamingContent`.
 *   - Maps `createdByMessageId` to the branch's copy of that message;
 *     `lastEditedByMessageId` is mapped if the editor message was in the
 *     copied range, otherwise dropped to `undefined`.
 *   - Inserts one `artifactRevisions` row with `editKind: 'branch'` so the
 *     branch's revision history begins with an explicit fork marker.
 *
 * Plain helper (not a Convex `internalMutation`) so the caller's mutation
 * transaction wraps both the message copy and the artifact snapshots —
 * either everything succeeds or nothing is written.
 */
export async function snapshotArtifactForBranch(
  ctx: MutationCtx,
  args: {
    source: Doc<'artifacts'>;
    snapshotContent: string;
    snapshotRevision: number;
    targetThreadId: string;
    mappedCreatedByMessageId: string;
    mappedLastEditedByMessageId?: string;
  },
): Promise<{ artifactId: Doc<'artifacts'>['_id'] }> {
  const { source } = args;
  const now = Date.now();
  const artifactId = await ctx.db.insert('artifacts', {
    organizationId: source.organizationId,
    threadId: args.targetThreadId,
    type: source.type,
    title: source.title,
    language: source.language,
    content: args.snapshotContent,
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
    content: args.snapshotContent,
    editedByMessageId:
      args.mappedLastEditedByMessageId ?? args.mappedCreatedByMessageId,
    editKind: 'branch',
    createdAt: now,
  });
  return { artifactId };
}
