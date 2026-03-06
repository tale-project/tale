/**
 * Get documents with cursor-based pagination (for infinite scroll)
 *
 * Uses early termination to avoid reading all documents,
 * preventing the "Too many bytes read" error regardless of data volume.
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { DocumentItemResponse } from './types';

import { getMetadataString } from '../lib/metadata/get_metadata_string';
import { paginateWithFilter, DEFAULT_PAGE_SIZE } from '../lib/pagination';
import { hasTeamAccess } from '../lib/team_access';
import { transformDocumentsBatch } from './transform_to_document_item';

export interface GetDocumentsCursorArgs {
  organizationId: string;
  numItems?: number;
  cursor: string | null;
  query?: string;
  folderPath?: string;
  userTeamIds?: string[];
  filterTeamId?: string;
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

  // Filter function for search, folder path, and team access
  const filter = (doc: Doc<'documents'>): boolean => {
    if (args.userTeamIds !== undefined) {
      if (!hasTeamAccess(doc, args.userTeamIds)) {
        return false;
      }
    }

    // Team filter: show org-wide docs + docs belonging to the selected team
    if (args.filterTeamId) {
      if (doc.teamId && doc.teamId !== args.filterTeamId) {
        return false;
      }
    }

    // Apply folder path filter
    if (folderPath) {
      const docPath = getMetadataString(doc.metadata, 'storagePath');
      if (docPath !== folderPath) {
        return false;
      }
    }

    // Apply search filter (case-insensitive contains)
    if (searchQuery) {
      const titleMatch = doc.title?.toLowerCase().includes(searchQuery);
      const nameMatch = getMetadataString(doc.metadata, 'name')
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

  // Transform documents to DocumentItemResponse format using batch processing
  // This efficiently fetches user names and storage URLs in parallel
  const items = await transformDocumentsBatch(ctx, result.page);

  return {
    page: items,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
