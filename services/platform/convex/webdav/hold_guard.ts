import { ConvexError } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { MAX_FOLDER_DEPTH } from '../folders/mutations';
import { loadActiveHolds, type ActiveHolds } from '../governance/legal_hold';
import { assertNotHeld } from '../governance/legal_hold_guard';

// Legal-hold gate for the WebDAV destructive surface (DELETE, MOVE/COPY
// overwrite, PUT overwrite). Every other delete path in the codebase flows
// through documents/internal_mutations.deleteDocumentById or folders.deleteFolder,
// which call assertNotHeld first; the WebDAV mutations patch lifecycleStatus
// directly and so would otherwise bypass it (the exact bypass class
// legal_hold_guard.ts's round-2 B4 closed). These wrappers re-apply the gate.
//
// We re-implement the descendant walk here (rather than reusing the private
// helper in folders/mutations.ts) so it matches the webdav cascade's bounded
// .collect() recursion + MAX_FOLDER_DEPTH style.

// Single-document gate. Throws ConvexError({code:'LEGAL_HOLD_ACTIVE'}) when the
// org is held or the document's author is on a custodian hold.
export async function assertWebdavDocNotHeld(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  doc: { _id: Id<'documents'>; createdBy?: string | null },
  holds?: ActiveHolds,
): Promise<void> {
  await assertNotHeld(
    ctx,
    organizationId,
    'document',
    doc._id,
    holds,
    doc.createdBy ?? undefined,
  );
}

// Folder-subtree gate. Asserts the org isn't held, then walks the whole subtree
// and refuses if any ACTIVE descendant document's author is on a custodian
// hold. MUST run to completion BEFORE any trash/delete so a held tree is never
// left half-deleted — mirrors folders/mutations.deleteFolder's pre-walk.
export async function assertWebdavFolderTreeNotHeld(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  folderId: Id<'folders'>,
  preloaded?: ActiveHolds,
  depth: number = 0,
): Promise<void> {
  const holds = preloaded ?? (await loadActiveHolds(ctx, organizationId));
  // Org-level hold is target-independent — assert it once at the root.
  if (depth === 0) {
    await assertNotHeld(ctx, organizationId, 'folder', folderId, holds);
  }
  if (depth > MAX_FOLDER_DEPTH) {
    throw new ConvexError({ code: 'CONFLICT' });
  }

  const childFolders = await ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (q) =>
      q.eq('organizationId', organizationId).eq('parentId', folderId),
    )
    .collect();
  for (const cf of childFolders) {
    await assertWebdavFolderTreeNotHeld(
      ctx,
      organizationId,
      cf._id,
      holds,
      depth + 1,
    );
  }

  const docs = await ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderId', (q) =>
      q.eq('organizationId', organizationId).eq('folderId', folderId),
    )
    .collect();
  for (const d of docs) {
    if ((d.lifecycleStatus ?? 'active') !== 'active') continue;
    if (d.createdBy && holds.userMembershipIds.has(d.createdBy)) {
      throw new ConvexError({
        code: 'LEGAL_HOLD_ACTIVE',
        message:
          'A document in this folder is owned by a user on a custodian legal hold. Release the user-level hold before deleting.',
        targetType: 'document',
        targetId: d._id,
        orgHeld: false,
        userCustodianHeld: true,
      });
    }
  }
}
