import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { MAX_FOLDER_DEPTH } from './mutations';

/**
 * Walk up from `startFolderId` and delete folders that have no remaining
 * documents and no child folders, stopping at (and never deleting)
 * `stopAtFolderId`. Aborts safely if the walk would escape the sync
 * subtree (parentId becomes undefined before reaching the stop boundary).
 *
 * Convex mutation semantics: each existence check + delete runs in a
 * single serializable transaction, so concurrent inserts under a folder
 * trigger an OCC retry on the inserting tx — the cleanup never strands
 * a dangling parentId.
 */
export async function cleanupEmptyAncestorFolders(
  ctx: MutationCtx,
  startFolderId: Id<'folders'>,
  stopAtFolderId: Id<'folders'>,
  organizationId: string,
): Promise<void> {
  let currentId: Id<'folders'> | undefined = startFolderId;
  let depth = 0;

  while (currentId && depth < MAX_FOLDER_DEPTH) {
    if (currentId === stopAtFolderId) {
      return;
    }

    const folder: Doc<'folders'> | null = await ctx.db.get(currentId);
    if (!folder) {
      return;
    }

    if (folder.organizationId !== organizationId) {
      console.warn(
        `[cleanupEmptyAncestorFolders] org mismatch at folderId=${currentId} (expected ${organizationId}, got ${folder.organizationId}); aborting`,
      );
      return;
    }

    // Reaching the org root without hitting the stop boundary means
    // either the doc's folderId pointed outside the sync subtree, or
    // the sync root was deleted concurrently. Either way: do not delete
    // — we would otherwise reap unrelated user-owned folders.
    if (folder.parentId === undefined) {
      console.warn(
        `[cleanupEmptyAncestorFolders] reached root folderId=${currentId} without hitting stopAt=${stopAtFolderId}; aborting`,
      );
      return;
    }

    const childFolder = await ctx.db
      .query('folders')
      .withIndex('by_org_parent_name', (q) =>
        q.eq('organizationId', organizationId).eq('parentId', currentId),
      )
      .first();
    if (childFolder) {
      return;
    }

    const childDoc = await ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_folderId', (q) =>
        q.eq('organizationId', organizationId).eq('folderId', currentId),
      )
      .first();
    if (childDoc) {
      return;
    }

    const parentId: Id<'folders'> | undefined = folder.parentId;
    await ctx.db.delete(currentId);
    currentId = parentId;
    depth++;
  }

  if (depth >= MAX_FOLDER_DEPTH && currentId && currentId !== stopAtFolderId) {
    console.warn(
      `[cleanupEmptyAncestorFolders] depth cap (${MAX_FOLDER_DEPTH}) hit before stopAt=${stopAtFolderId}; remaining folderId=${currentId}`,
    );
  }
}
