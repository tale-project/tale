import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export interface OrphanedExternalDoc {
  documentId: Id<'documents'>;
  externalItemId: string;
  fileId?: Id<'_storage'>;
}

export interface ListOrphanedExternalDocsArgs {
  organizationId: string;
  sourceProvider: string;
  folderPathPrefix: string;
  presentExternalIds: string[];
}

export async function listOrphanedExternalDocs(
  ctx: QueryCtx,
  args: ListOrphanedExternalDocsArgs,
): Promise<OrphanedExternalDoc[]> {
  const presentSet = new Set(args.presentExternalIds);
  const root = args.folderPathPrefix;
  const orphaned: OrphanedExternalDoc[] = [];

  const collectIfOrphan = (doc: {
    _id: Id<'documents'>;
    sourceProvider?: string;
    externalItemId?: string;
    fileId?: Id<'_storage'>;
  }) => {
    if (
      doc.sourceProvider === args.sourceProvider &&
      doc.externalItemId &&
      !presentSet.has(doc.externalItemId)
    ) {
      orphaned.push({
        documentId: doc._id,
        externalItemId: doc.externalItemId,
        fileId: doc.fileId,
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
