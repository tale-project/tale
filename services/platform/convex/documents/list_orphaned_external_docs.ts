import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { BlobRef } from '../lib/storage/blob_ref';

export interface OrphanedExternalDoc {
  documentId: Id<'documents'>;
  externalItemId: string;
  fileId?: BlobRef;
  title?: string;
}

export interface ListOrphanedExternalDocsArgs {
  organizationId: string;
  sourceProvider: string;
  folderPathPrefix: string;
  presentExternalIds: string[];
  /** When set, only orphan docs whose `driveId` matches. Lets two Drive
   * (or other) connectors in one org coexist under overlapping
   * `folderPathPrefix`es without mutually orphaning each other. Missing
   * = legacy behavior (no connector scope). */
  driveId?: string;
}

export async function listOrphanedExternalDocs(
  ctx: QueryCtx,
  args: ListOrphanedExternalDocsArgs,
): Promise<OrphanedExternalDoc[]> {
  const presentSet = new Set(args.presentExternalIds);
  // Normalize trailing slash so a workflow input like "Inbox/" doesn't
  // collapse the subtree range to "Inbox//".."Inbox//￿".
  const root = args.folderPathPrefix.replace(/\/+$/, '');
  const orphaned: OrphanedExternalDoc[] = [];

  const collectIfOrphan = (doc: {
    _id: Id<'documents'>;
    sourceProvider?: string;
    externalItemId?: string;
    fileId?: BlobRef;
    title?: string;
    driveId?: string;
    lifecycleStatus?: string;
  }) => {
    // Skip soft-deleted rows (trashed/expired/deleted) — the Trash UI
    // grace window depends on those rows surviving until the user
    // restores or the grace period elapses; reconcile must not hard-
    // delete them out from under that flow.
    const status = doc.lifecycleStatus ?? 'active';
    if (status !== 'active') return;
    if (args.driveId !== undefined && doc.driveId !== args.driveId) return;
    if (
      doc.sourceProvider === args.sourceProvider &&
      doc.externalItemId &&
      !presentSet.has(doc.externalItemId)
    ) {
      orphaned.push({
        documentId: doc._id,
        externalItemId: doc.externalItemId,
        fileId: doc.fileId,
        title: doc.title,
      });
    }
  };

  // Exact match for the sync root itself.
  for await (const doc of ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderPath', (q) =>
      q.eq('organizationId', args.organizationId).eq('folderPath', root),
    )) {
    collectIfOrphan(doc);
  }

  // Subtree range scan: [root + '/', root + '/￿').
  // The '/' separator is required: a bare `< root + '￿'` would also
  // match siblings like "Test 2/x" because space (0x20) sorts below '/' (0x2F).
  for await (const doc of ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderPath', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .gte('folderPath', root + '/')
        .lt('folderPath', root + '/￿'),
    )) {
    collectIfOrphan(doc);
  }

  return orphaned;
}
