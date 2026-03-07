/**
 * List documents for agent tool
 *
 * Core query logic for the document_list agent tool.
 * Supports filtering by folder path, extension, team, date range, and title query.
 * Applies team-based access control and returns a lightweight response.
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import { getNumber } from '../../lib/utils/type-guards';
import { buildBreadcrumb } from '../folders/queries';
import { hasTeamAccess } from '../lib/team_access';

const MAX_SCAN = 10_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface AgentDocumentItem {
  id: string;
  title: string;
  extension: string | null;
  folderPath: string | null;
  teamId: string | null;
  createdAt: number;
  sizeBytes: number | null;
}

export interface AgentDocumentListResult {
  documents: AgentDocumentItem[];
  totalCount: number | null;
  hasMore: boolean;
  cursor: number | null;
  warning: string | null;
}

export async function listDocumentsForAgent(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    userTeamIds: string[];
    folderPath?: string;
    extension?: string;
    teamId?: string;
    dateFrom?: number;
    dateTo?: number;
    query?: string;
    sortBy?: 'createdAt' | 'name';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    cursor?: number;
    _maxScan?: number;
  },
): Promise<AgentDocumentListResult> {
  const maxScan = args._maxScan ?? MAX_SCAN;
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const sortBy = args.sortBy ?? 'createdAt';
  const sortOrder = args.sortOrder ?? 'desc';
  const searchQuery = args.query?.trim().toLowerCase();
  const teamIdSet = new Set(args.userTeamIds);
  const emptyResult: AgentDocumentListResult = {
    documents: [],
    totalCount: 0,
    hasMore: false,
    cursor: null,
    warning: null,
  };

  // Validate teamId filter against user's teams
  if (args.teamId && !teamIdSet.has(args.teamId)) {
    return emptyResult;
  }

  // Resolve folderPath to folderId
  let folderId: Id<'folders'> | undefined;
  if (args.folderPath) {
    const resolved = await resolveFolderPath(
      ctx,
      args.organizationId,
      args.folderPath,
    );
    // undefined means path resolved to empty segments (e.g., "/", "///")
    // — treat as "no folder filter". null means a named folder was not found.
    if (resolved === null) return emptyResult;
    folderId = resolved;
  }

  // Select best index and build query
  const baseQuery = buildQuery(
    ctx,
    args.organizationId,
    folderId,
    args.extension,
  );

  // Iterate and filter
  const matches: Array<Doc<'documents'>> = [];
  let scanned = 0;
  let scanLimitHit = false;

  for await (const doc of baseQuery) {
    scanned++;
    if (scanned > maxScan) {
      scanLimitHit = true;
      break;
    }

    if (args.extension && doc.extension !== args.extension) continue;

    // Team filter
    if (args.teamId) {
      if (doc.teamId !== args.teamId) continue;
    } else if (!hasTeamAccess(doc, teamIdSet)) {
      continue;
    }

    // Date range filter
    if (args.dateFrom != null && doc._creationTime < args.dateFrom) continue;
    if (args.dateTo != null && doc._creationTime > args.dateTo) continue;

    // Title search (check metadata.name fallback, consistent with UI)
    if (searchQuery) {
      const titleMatch =
        doc.title?.toLowerCase().includes(searchQuery) ||
        (typeof doc.metadata?.name === 'string' &&
          doc.metadata.name.toLowerCase().includes(searchQuery));
      if (!titleMatch) continue;
    }

    matches.push(doc);
  }

  const totalCount = scanLimitHit ? null : matches.length;

  // Sort with _id tiebreaker for deterministic ordering
  matches.sort((a, b) => {
    const aVal =
      sortBy === 'name'
        ? (a.title ??
          (typeof a.metadata?.name === 'string' ? a.metadata.name : '') ??
          '')
        : a._creationTime;
    const bVal =
      sortBy === 'name'
        ? (b.title ??
          (typeof b.metadata?.name === 'string' ? b.metadata.name : '') ??
          '')
        : b._creationTime;
    if (aVal !== bVal) {
      const comparison = aVal < bVal ? -1 : 1;
      return sortOrder === 'asc' ? comparison : -comparison;
    }
    return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
  });

  // Offset-based pagination (cursor is a start index)
  const startIndex = Math.max(0, args.cursor ?? 0);
  const page = matches.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < matches.length;

  // Batch-resolve folder paths
  const folderPathMap = await resolveFolderPaths(ctx, page);

  // Build response
  const documents: AgentDocumentItem[] = page.map((doc) => ({
    id: doc._id,
    title:
      doc.title ??
      (typeof doc.metadata?.name === 'string' ? doc.metadata.name : null) ??
      'Untitled',
    extension: doc.extension ?? null,
    folderPath: doc.folderId ? (folderPathMap.get(doc.folderId) ?? null) : null,
    teamId: doc.teamId ?? null,
    createdAt: doc._creationTime,
    sizeBytes: extractSize(doc.metadata),
  }));

  const nextCursor = hasMore ? startIndex + limit : null;

  const warning = scanLimitHit
    ? `Scan limit reached: scanned ${maxScan} documents, found ${matches.length} matches. Results may be incomplete. Narrow your filters (folderPath, extension, teamId, dateFrom/dateTo) for complete results.`
    : null;

  return { documents, totalCount, hasMore, cursor: nextCursor, warning };
}

async function resolveFolderPath(
  ctx: QueryCtx,
  organizationId: string,
  folderPath: string,
): Promise<Id<'folders'> | null | undefined> {
  const cleanPath = folderPath.startsWith('/')
    ? folderPath.slice(1)
    : folderPath;
  const segments = cleanPath.split('/').filter(Boolean);

  // Empty segments (e.g., "/", "///") — treat as no folder filter
  if (segments.length === 0) return undefined;

  let currentFolderId: Id<'folders'> | undefined;
  for (const segment of segments) {
    const folder = await ctx.db
      .query('folders')
      .withIndex('by_org_parent_name', (qb) =>
        qb
          .eq('organizationId', organizationId)
          .eq('parentId', currentFolderId)
          .eq('name', segment),
      )
      .first();

    // Named folder not found
    if (!folder) return null;
    currentFolderId = folder._id;
  }

  return currentFolderId;
}

function buildQuery(
  ctx: QueryCtx,
  organizationId: string,
  folderId: Id<'folders'> | undefined,
  extension: string | undefined,
) {
  // desc order ensures newest docs are scanned first when MAX_SCAN is hit
  if (folderId) {
    return ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_folderId', (q) =>
        q.eq('organizationId', organizationId).eq('folderId', folderId),
      )
      .order('desc');
  }

  if (extension) {
    return ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_extension', (q) =>
        q.eq('organizationId', organizationId).eq('extension', extension),
      )
      .order('desc');
  }

  return ctx.db
    .query('documents')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    )
    .order('desc');
}

async function resolveFolderPaths(
  ctx: QueryCtx,
  docs: Array<Doc<'documents'>>,
): Promise<Map<Id<'folders'>, string>> {
  const uniqueFolderIds = new Set<Id<'folders'>>();
  for (const doc of docs) {
    if (doc.folderId) uniqueFolderIds.add(doc.folderId);
  }

  const pathMap = new Map<Id<'folders'>, string>();
  const breadcrumbPromises = [...uniqueFolderIds].map(async (id) => {
    try {
      const breadcrumb = await buildBreadcrumb(ctx, id);
      const path = breadcrumb.map((b) => b.name).join('/');
      pathMap.set(id, path);
    } catch {
      // Orphaned/corrupt folder — document will show folderPath: null
    }
  });

  await Promise.all(breadcrumbPromises);
  return pathMap;
}

function extractSize(
  metadata: Record<string, unknown> | undefined,
): number | null {
  if (!metadata) return null;
  return getNumber(metadata, 'size') ?? null;
}
