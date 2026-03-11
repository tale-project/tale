/**
 * List documents for agent tool
 *
 * Core query logic for the document_list agent tool.
 * Supports filtering by folder path, extension, team, date range, and file name search.
 * Applies team-based access control and returns a lightweight response.
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import { getNumber } from '../../lib/utils/type-guards';
import { buildBreadcrumb } from '../folders/queries';
import {
  fuzzyMatchFolder,
  fuzzyMatchTitle,
  levenshteinDistance,
} from '../lib/fuzzy_match';
import { hasTeamAccess } from '../lib/team_access';

const MAX_SCAN = 10_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface AgentDocumentItem {
  id: string;
  fileId: string;
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
    fileName?: string;
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
  const searchQuery = args.fileName?.trim();
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
    return {
      ...emptyResult,
      warning: 'No access to the specified team, or team does not exist.',
    };
  }

  // Resolve folderPath to folderIds via in-memory directory tree + fuzzy matching
  let folderIds: Id<'folders'>[] | undefined;
  let folderIdSet: Set<string> | undefined;
  let folderWarning: string | null = null;
  if (args.folderPath) {
    const resolved = await resolveFolderPathFuzzy(
      ctx,
      args.organizationId,
      args.folderPath,
    );
    if (resolved === undefined) {
      // Empty segments (e.g., "/", "///") — treat as no folder filter
    } else if ('notFound' in resolved) {
      return {
        ...emptyResult,
        warning: `Folder '${resolved.path}' not found.`,
      };
    } else {
      folderIds = resolved.folderIds;
      folderIdSet = new Set<string>(resolved.folderIds);
      if (resolved.folderIds.length > 1) {
        folderWarning = `Showing results from ${resolved.resolvedPaths.length} folders matching "${args.folderPath}": ${resolved.resolvedPaths.map((p) => `"${p}"`).join(', ')}. Use a more specific folderPath to narrow results.`;
      }
    }
  }

  // Select best index and build query
  // Use folder index only for single-folder match; multi-folder filters in scan loop
  const baseQuery = buildQuery(
    ctx,
    args.organizationId,
    folderIds?.length === 1 ? folderIds[0] : undefined,
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

    if (!doc.fileId) continue;
    if (folderIdSet && !folderIdSet.has(doc.folderId ?? '')) continue;
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

    // File name search (fuzzy match — handles typos, case, partial names)
    if (searchQuery) {
      if (!fuzzyMatchTitle(searchQuery, getDocumentTitle(doc))) continue;
    }

    matches.push(doc);
  }

  const totalCount = scanLimitHit ? null : matches.length;

  // Sort with _id tiebreaker for deterministic ordering
  if (sortBy === 'name') {
    const entries = matches.map((doc) => ({
      doc,
      key: getDocumentTitle(doc).toLowerCase(),
    }));
    entries.sort((a, b) => {
      if (a.key !== b.key) {
        const cmp = a.key < b.key ? -1 : 1;
        return sortOrder === 'asc' ? cmp : -cmp;
      }
      return a.doc._id < b.doc._id ? -1 : a.doc._id > b.doc._id ? 1 : 0;
    });
    matches.length = 0;
    for (const e of entries) matches.push(e.doc);
  } else {
    matches.sort((a, b) => {
      if (a._creationTime !== b._creationTime) {
        const cmp = a._creationTime < b._creationTime ? -1 : 1;
        return sortOrder === 'asc' ? cmp : -cmp;
      }
      return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
    });
  }

  // Offset-based pagination (cursor is a start index)
  const startIndex = Math.max(0, args.cursor ?? 0);
  const page = matches.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < matches.length;

  // Batch-resolve folder paths
  const folderPathMap = await resolveFolderPaths(ctx, page);

  // Build response — type guard narrows fileId (already filtered on line 118)
  const docsWithFile = page.filter(
    (doc): doc is Doc<'documents'> & { fileId: Id<'_storage'> } =>
      doc.fileId != null,
  );

  const documents: AgentDocumentItem[] = docsWithFile.map((doc) => ({
    id: doc._id,
    fileId: doc.fileId,
    title: getDocumentTitle(doc),
    extension: doc.extension ?? null,
    folderPath: doc.folderId ? (folderPathMap.get(doc.folderId) ?? null) : null,
    teamId: doc.teamId ?? null,
    createdAt: doc._creationTime,
    sizeBytes: extractSize(doc.metadata),
  }));

  const nextCursor = hasMore ? startIndex + limit : null;

  const scanWarning = scanLimitHit
    ? `Scan limit reached: scanned ${maxScan} documents, found ${matches.length} matches. Results may be incomplete. Narrow your filters (folderPath, extension, teamId, dateFrom/dateTo) for complete results.`
    : null;

  const warnings = [folderWarning, scanWarning].filter(Boolean);
  const warning = warnings.length > 0 ? warnings.join(' ') : null;

  return { documents, totalCount, hasMore, cursor: nextCursor, warning };
}

function getDocumentTitle(doc: Doc<'documents'>): string {
  return (
    doc.title ??
    (typeof doc.metadata?.name === 'string' ? doc.metadata.name : null) ??
    'Untitled'
  );
}

type FolderEntry = {
  id: Id<'folders'>;
  name: string;
  parentId: Id<'folders'> | undefined;
};

type FolderResolveResult =
  | { folderIds: Id<'folders'>[]; resolvedPaths: string[] }
  | { notFound: true; path: string }
  | undefined;

/**
 * Resolve a folder path using in-memory global search + fuzzy matching.
 *
 * Loads all folders for the org into memory, then searches the ENTIRE tree
 * (not just from root) for folders matching the given path. This means
 * `folderPath: "sub"` will find a nested folder `templates/sub` if it exists.
 *
 * For single-segment paths: fuzzy-match the name against ALL folders globally.
 * For multi-segment paths: find candidates matching the last segment, then
 * verify ancestor chains match the preceding segments.
 *
 * Unique match → auto-resolve. Multiple matches → return full-path suggestions.
 *
 * This approach is chosen over a persistent cache because:
 * - Folders are few (typically <1K per org), so loading all is cheap (<200KB)
 * - A persistent cache would require sync hooks in 13+ write paths
 * - Query-time matching has zero side effects and always reads fresh data
 *
 * See `lib/fuzzy_match.ts` for the full design rationale.
 */
async function resolveFolderPathFuzzy(
  ctx: QueryCtx,
  organizationId: string,
  folderPath: string,
): Promise<FolderResolveResult> {
  const cleanPath = folderPath.startsWith('/')
    ? folderPath.slice(1)
    : folderPath;
  const segments = cleanPath.split('/').filter(Boolean);

  if (segments.length === 0) return undefined;

  // Load all folders for this org into memory
  const allFolders: FolderEntry[] = [];
  const folderById = new Map<string, FolderEntry>();

  const folderQuery = ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (qb) =>
      qb.eq('organizationId', organizationId),
    );

  for await (const folder of folderQuery) {
    const entry: FolderEntry = {
      id: folder._id,
      name: folder.name,
      parentId: folder.parentId,
    };
    allFolders.push(entry);
    folderById.set(folder._id, entry);
  }

  // Find all folders matching the last segment (fuzzy)
  const lastSegment = segments[segments.length - 1];
  const lastSegmentCandidates = allFolders.map((f) => ({
    name: f.name,
    id: f.id,
  }));

  const leafResult = fuzzyMatchFolder(lastSegment, lastSegmentCandidates);
  if (!leafResult) {
    return { notFound: true, path: folderPath };
  }

  // Collect all matched folder IDs via folderById lookup (avoids unsafe cast)
  const leafIds: Id<'folders'>[] = [];
  if ('match' in leafResult) {
    const entry = folderById.get(leafResult.match.id);
    if (entry) leafIds.push(entry.id);
  } else {
    const seen = new Set<string>();
    for (const name of leafResult.suggestions) {
      for (const f of allFolders) {
        if (f.name === name && !seen.has(f.id)) {
          seen.add(f.id);
          leafIds.push(f.id);
        }
      }
    }
  }

  // For single-segment paths, all leaf matches are valid
  // For multi-segment paths, verify ancestor chain matches preceding segments
  const validFolders: Id<'folders'>[] = [];

  for (const fid of leafIds) {
    if (segments.length === 1) {
      validFolders.push(fid);
    } else {
      const ancestorNames = buildAncestorNames(fid, folderById);
      // ancestorNames = ["root", ..., "parent", "self"] (bottom-up reversed to top-down)
      // Check if segments match as a suffix of ancestorNames
      if (matchesPathSuffix(segments, ancestorNames)) {
        validFolders.push(fid);
      }
    }
  }

  if (validFolders.length > 0) {
    const resolvedPaths = validFolders.map((fid) =>
      buildFullPath(fid, folderById),
    );
    return { folderIds: validFolders, resolvedPaths };
  }

  // No valid matches — try leaf matches (ancestor chain didn't match)
  if (leafIds.length > 0) {
    const resolvedPaths = leafIds.map((fid) => buildFullPath(fid, folderById));
    return { folderIds: leafIds, resolvedPaths };
  }

  return { notFound: true, path: folderPath };
}

/**
 * Build the full ancestor name chain for a folder (top-down order).
 * e.g., for folder "sub" under "templates": ["templates", "sub"]
 */
function buildAncestorNames(
  folderId: Id<'folders'>,
  folderById: Map<string, FolderEntry>,
): string[] {
  const names: string[] = [];
  let currentId: string | undefined = folderId;
  while (currentId) {
    const folder = folderById.get(currentId);
    if (!folder) break;
    names.unshift(folder.name);
    currentId = folder.parentId;
  }
  return names;
}

/**
 * Build a full path string for a folder (e.g., "templates/sub").
 */
function buildFullPath(
  folderId: Id<'folders'>,
  folderById: Map<string, FolderEntry>,
): string {
  return buildAncestorNames(folderId, folderById).join('/');
}

/**
 * Check if input segments match as a suffix of the ancestor path.
 * Uses case-insensitive comparison at each level.
 *
 * e.g., segments=["templates","sub"], ancestors=["root","templates","sub"] → true
 * e.g., segments=["templates","sub"], ancestors=["other","sub"] → false
 */
function matchesPathSuffix(
  segments: string[],
  ancestorNames: string[],
): boolean {
  if (segments.length > ancestorNames.length) return false;

  const offset = ancestorNames.length - segments.length;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].toLowerCase();
    const anc = ancestorNames[offset + i].toLowerCase();
    if (seg !== anc) {
      const threshold = Math.max(2, Math.floor(seg.length * 0.3));
      if (levenshteinDistance(seg, anc) > threshold) return false;
    }
  }
  return true;
}

// Index priority: folderId (most selective) > extension > org-only (broadest)
function buildQuery(
  ctx: QueryCtx,
  organizationId: string,
  singleFolderId: Id<'folders'> | undefined,
  extension: string | undefined,
) {
  // desc order ensures newest docs are scanned first when MAX_SCAN is hit
  if (singleFolderId) {
    return ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_folderId', (q) =>
        q.eq('organizationId', organizationId).eq('folderId', singleFolderId),
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
    } catch (err) {
      console.warn(`buildBreadcrumb failed for folder ${id}:`, err);
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
