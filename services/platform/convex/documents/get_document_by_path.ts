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
import type { DocumentItemResponse } from './types';

import { transformDocumentsBatch } from './transform_to_document_item';

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

    // Traverse folder hierarchy
    let folderId: Id<'folders'> | undefined;
    for (const segment of parts) {
      const q = ctx.db
        .query('folders')
        .withIndex('by_organizationId_and_parentId', (qb) =>
          qb.eq('organizationId', organizationId).eq('parentId', folderId),
        );

      let found = false;
      for await (const folder of q) {
        if (folder.name === segment) {
          folderId = folder._id;
          found = true;
          break;
        }
      }

      if (!found) {
        return { success: false, error: 'Document not found' };
      }
    }

    // Find document by title in the resolved folder
    const docQuery = ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_folderId', (q) =>
        q.eq('organizationId', organizationId).eq('folderId', folderId),
      );

    let document = null;
    for await (const doc of docQuery) {
      if (doc.title === fileName) {
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
