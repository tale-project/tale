/**
 * Get document by storage path (for public API / agent tool)
 *
 * Resolves a full path like "org1/docs/reports/report.pdf" by:
 * 1. Splitting into folder segments and filename
 * 2. Traversing the folders table to find the target folder
 * 3. Querying documents in that folder by title
 */

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { isActiveDocument } from './_helpers';
import { transformDocumentsBatch } from './transform_to_document_item';
import type { DocumentItemResponse } from './types';

export async function getDocumentByPath(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    storagePath: string;
  },
): Promise<
  | { success: true; item: DocumentItemResponse }
  | { success: false; error: string }
> {
  try {
    const { organizationId, storagePath } = args;

    // Strip org prefix if present
    const pathWithoutOrg = storagePath.startsWith(organizationId + '/')
      ? storagePath.slice(organizationId.length + 1)
      : storagePath;

    const parts = pathWithoutOrg.split('/');
    const fileName = parts.pop();
    if (!fileName) {
      return { success: false, error: 'Invalid path' };
    }

    // Traverse folder hierarchy using the hub-exact compound index —
    // document paths are a Knowledge Hub concept and must never resolve
    // through a project folder that shares (org, parent, name).
    let folderId: Id<'folders'> | undefined;
    for (const segment of parts) {
      const folder = await ctx.db
        .query('folders')
        .withIndex('by_org_project_parent_name', (qb) =>
          qb
            .eq('organizationId', organizationId)
            .eq('projectId', undefined)
            .eq('parentId', folderId)
            .eq('name', segment),
        )
        .first();

      if (!folder) {
        return { success: false, error: 'Path not found' };
      }
      folderId = folder._id;
    }

    // Find document by title in the resolved folder
    const docQuery = ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_folderId', (q) =>
        q.eq('organizationId', organizationId).eq('folderId', folderId),
      );

    let document = null;
    for await (const doc of docQuery) {
      // A trashed/expired doc at this path must resolve as "not found" — it is
      // shown in Trash, not the live tree (e.g. after a WebDAV DELETE).
      if (doc.title === fileName && isActiveDocument(doc)) {
        document = doc;
        break;
      }
    }

    if (!document) {
      return { success: false, error: 'Document not found' };
    }

    const [item] = await transformDocumentsBatch(ctx, [document]);
    return { success: true, item };
  } catch (error) {
    console.error('Error getting document by path:', error);
    return { success: false, error: 'Failed to retrieve document' };
  }
}
