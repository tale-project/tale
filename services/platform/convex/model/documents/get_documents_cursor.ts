/**
 * Get documents with cursor-based pagination (for infinite scroll)
 *
 * Uses early termination to avoid reading all documents,
 * preventing the "Too many bytes read" error regardless of data volume.
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import type { DocumentItemResponse, DocumentMetadata } from './types';
import { paginateWithFilter, DEFAULT_PAGE_SIZE } from '../../lib/pagination';
import { transformToDocumentItem } from './transform_to_document_item';

export interface GetDocumentsCursorArgs {
  organizationId: string;
  numItems?: number;
  cursor: string | null;
  query?: string;
  folderPath?: string;
}

export interface CursorPaginatedDocumentsResult {
  page: DocumentItemResponse[];
  isDone: boolean;
  continueCursor: string;
}

export async function getDocumentsCursor(
  ctx: QueryCtx,
  args: GetDocumentsCursorArgs,
): Promise<CursorPaginatedDocumentsResult> {
  const numItems = args.numItems ?? DEFAULT_PAGE_SIZE;
  const searchQuery = args.query?.trim().toLowerCase() ?? '';
  const folderPath = args.folderPath ?? '';

  // Build query with optimal index
  const baseQuery = ctx.db
    .query('documents')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .order('desc');

  // Filter function for search and folder path
  const filter = (doc: Doc<'documents'>): boolean => {
    // Apply folder path filter
    if (folderPath) {
      const docPath = (doc.metadata as DocumentMetadata | undefined)?.storagePath;
      if (docPath !== folderPath) {
        return false;
      }
    }

    // Apply search filter (case-insensitive contains)
    if (searchQuery) {
      const titleMatch = doc.title?.toLowerCase().includes(searchQuery);
      const nameMatch = (doc.metadata as DocumentMetadata | undefined)?.name
        ?.toLowerCase()
        .includes(searchQuery);

      if (!titleMatch && !nameMatch) {
        return false;
      }
    }

    return true;
  };

  // Use paginateWithFilter for early termination
  const result = await paginateWithFilter(baseQuery, {
    numItems,
    cursor: args.cursor,
    filter,
  });

  // Transform documents to DocumentItemResponse format (expensive operation - only on paginated subset)
  const items = await Promise.all(
    result.page.map((doc) => transformToDocumentItem(ctx, doc)),
  );

  return {
    page: items,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
