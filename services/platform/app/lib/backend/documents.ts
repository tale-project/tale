/**
 * Documents vertical over the 0.5 backend — the Knowledge Hub (documents +
 * folders), the project Files tab, and the session upload lane. Response
 * types are DERIVED from the 0.4 function signatures (`FunctionReturnType`);
 * the backend already serves the 0.4 `DocumentItemResponse` view (rag
 * projection, presigned urls, creator names, record badge), so most reads
 * pass through, and the folder rows get their `id` → `_id` projection here.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { FunctionReturnType } from 'convex/server';

import type { api } from '@/convex/_generated/api';

import { BackendApiError, backendFetch, backendUrl } from './api-client';
import type {
  AdaptedPaginatedOptions,
  AdapterContext,
  PaginatedAdapter,
  ReadAdapter,
  WriteAdapter,
} from './convex-adapters';
import { backendEntityPrefix, backendKey } from './query-keys';

// ---------------------------------------------------------------------------
// Wire rows + 0.4-shape projections
// ---------------------------------------------------------------------------

type DocumentItem = FunctionReturnType<
  typeof api.documents.queries.listDocuments
>[number];
type DocumentVersionsResult = FunctionReturnType<
  typeof api.documents.queries.listDocumentVersions
>;
type DocumentByExternalIdResult = FunctionReturnType<
  typeof api.documents.queries.getDocumentByExternalItemId
>;
type UploadUsageResult = FunctionReturnType<
  typeof api.documents.queries.getUploadUsage
>;
type DocumentSearchHit = FunctionReturnType<
  typeof api.documents.search.searchDocuments
>[number];
type ProjectDocumentItem = FunctionReturnType<
  typeof api.projects.queries.listProjectDocuments
>[number];
type PendingRecordReviewResult = FunctionReturnType<
  typeof api.documents.records.getPendingDocumentRecordReview
>;
type LastRecordReviewResult = FunctionReturnType<
  typeof api.documents.records.getLastDocumentRecordReview
>;
type RespondToRecordReviewResult = FunctionReturnType<
  typeof api.documents.records.respondToDocumentRecordReview
>;
type SubmitRecordResult = FunctionReturnType<
  typeof api.documents.records.submitRecordForReview
>;
type MemberListItem = FunctionReturnType<
  typeof api.members.queries.listByOrganization
>[number];

/** One member row as the pg backend returns it (`GET /members`). */
interface MemberListWire {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: string;
  displayName: string | null;
  email: string | null;
  twoFactorEnabled: boolean;
  passkeyCount: number;
}
type ProjectFolderItem = FunctionReturnType<
  typeof api.projects.queries.listProjectFolders
>[number];
type FolderDoc = NonNullable<
  FunctionReturnType<typeof api.folders.queries.listFolders>
>[number];
type GetFolderResult = FunctionReturnType<typeof api.folders.queries.getFolder>;

/** The wire item — the 0.4 `DocumentItemResponse` plus the pg extras the
 * Files-tab projection needs (`fileId`). */
type DocumentItemWire = DocumentItem & { fileId?: string };

/** One folder as the pg backend returns it. */
interface FolderWire {
  id: string;
  organizationId: string;
  name: string;
  parentId: string | null;
  teamId: string | null;
  teamTags: string[];
  projectId: string | null;
  createdBy: string | null;
  createdAt: number;
  syncConfigId?: string;
}

function folderView(row: FolderWire): FolderDoc {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg ids stand in for Convex ids on the 0.4 wire shape
  return {
    _id: row.id,
    _creationTime: row.createdAt,
    organizationId: row.organizationId,
    name: row.name,
    ...(row.parentId !== null ? { parentId: row.parentId } : {}),
    ...(row.teamId !== null ? { teamId: row.teamId } : {}),
    ...(row.teamTags.length > 0 ? { teamTags: row.teamTags } : {}),
    ...(row.projectId !== null ? { projectId: row.projectId } : {}),
    ...(row.createdBy !== null ? { createdBy: row.createdBy } : {}),
    syncConfigId: row.syncConfigId,
  } as FolderDoc;
}

/** The Files tab's light row, projected from the item view. */
function projectDocumentView(item: DocumentItemWire): ProjectDocumentItem {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg ids stand in for Convex ids on the 0.4 wire shape
  return {
    _id: item.id,
    _creationTime: item.uploadedAt ?? 0,
    title: item.name,
    ...(item.fileId !== undefined ? { fileId: item.fileId } : {}),
    ...(item.mimeType !== undefined ? { mimeType: item.mimeType } : {}),
    ...(item.extension !== undefined ? { extension: item.extension } : {}),
    ...(item.folderId !== undefined ? { folderId: item.folderId } : {}),
    indexed: item.ragStatus === 'completed',
    ragStatus: item.ragStatus ?? null,
    ...(item.createdBy !== undefined ? { createdBy: item.createdBy } : {}),
    ...(item.sourceProvider !== undefined
      ? { sourceProvider: item.sourceProvider }
      : {}),
    ...(item.record !== undefined ? { record: item.record } : {}),
  } as ProjectDocumentItem;
}

// ---------------------------------------------------------------------------
// Read adapters
// ---------------------------------------------------------------------------

function orgOf(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string | undefined {
  const fromArgs = args.organizationId;
  if (typeof fromArgs === 'string' && fromArgs.length > 0) return fromArgs;
  return ctx.organizationId;
}

/** Hub root listing options — shared by the hook row and route loaders. */
export function hubDocumentsQuery(orgId: string): {
  queryKey: readonly unknown[];
  queryFn: () => Promise<DocumentItem[]>;
} {
  return {
    queryKey: backendKey(orgId, 'document', 'list'),
    queryFn: () =>
      backendFetch<{ documents: DocumentItem[] }>('/documents', {
        orgId,
      }).then((body) => body.documents),
  };
}

/** Approximate org document count — exported for the route loader. */
export function approxDocumentCountQuery(orgId: string): {
  queryKey: readonly unknown[];
  queryFn: () => Promise<number>;
} {
  return {
    queryKey: backendKey(orgId, 'document', 'approx-count'),
    queryFn: () =>
      backendFetch<{ count: number }>('/documents/approx-count', {
        orgId,
      }).then((body) => body.count),
  };
}

/** Hub folder listing options (`parentId` undefined = roots) — exported for
 * the route loader. */
export function hubFoldersQuery(
  orgId: string,
  parentId?: string,
): { queryKey: readonly unknown[]; queryFn: () => Promise<FolderDoc[]> } {
  return {
    queryKey: backendKey(orgId, 'folder', 'list', parentId ?? null),
    queryFn: () =>
      backendFetch<{ folders: FolderWire[] }>(
        parentId === undefined
          ? '/folders?parentId='
          : `/folders?parentId=${encodeURIComponent(parentId)}`,
        { orgId },
      ).then((body) => body.folders.map(folderView)),
  };
}

export const documentReadAdapters: Record<string, ReadAdapter> = {
  'documents/queries:listDocuments': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return hubDocumentsQuery(orgId);
  },
  'documents/queries:approxCountDocuments': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return approxDocumentCountQuery(orgId);
  },
  'documents/queries:getUploadUsage': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'document', 'upload-usage'),
      queryFn: () =>
        backendFetch<UploadUsageResult>('/documents/upload-usage', { orgId }),
    };
  },
  'documents/queries:getDocumentById': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const documentId = args.documentId;
    if (orgId === undefined || typeof documentId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'document', 'detail', documentId),
      queryFn: () =>
        backendFetch<{ document: DocumentItem | null }>(
          `/documents/${encodeURIComponent(documentId)}`,
          { orgId },
        ).then(
          (body) => body.document,
          (error: unknown) => {
            if (
              error instanceof BackendApiError &&
              (error.status === 404 || error.status === 403)
            ) {
              return null;
            }
            throw error;
          },
        ),
    };
  },
  'documents/queries:listDocumentVersions': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const documentId = args.documentId;
    if (orgId === undefined || typeof documentId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'document', 'versions', documentId),
      queryFn: () =>
        backendFetch<{ versions: DocumentVersionsResult }>(
          `/documents/versions/${encodeURIComponent(documentId)}`,
          { orgId },
        ).then((body) => body.versions),
    };
  },
  'documents/queries:getDocumentByExternalItemId': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const externalItemId = args.externalItemId;
    if (orgId === undefined || typeof externalItemId !== 'string') return null;
    const projectId =
      typeof args.projectId === 'string' ? args.projectId : undefined;
    const query = new URLSearchParams({ externalItemId });
    if (projectId !== undefined) query.set('projectId', projectId);
    return {
      queryKey: backendKey(
        orgId,
        'document',
        'by-external-item-id',
        externalItemId,
        projectId ?? null,
      ),
      queryFn: () =>
        backendFetch<{ document: DocumentByExternalIdResult }>(
          `/documents/by-external-item-id?${query.toString()}`,
          { orgId },
        ).then((body) => body.document),
    };
  },
  'documents/search:searchDocuments': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const query = args.query;
    if (orgId === undefined || typeof query !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'document', 'search-hub', query),
      queryFn: () =>
        backendFetch<{ documents: DocumentSearchHit[] }>(
          `/documents/search-hub?q=${encodeURIComponent(query)}`,
          { orgId },
        ).then((body) => body.documents),
    };
  },
  'members/queries:listByOrganization': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'member', 'list'),
      queryFn: () =>
        backendFetch<{ members: MemberListWire[] }>('/members', {
          orgId,
        }).then((body) =>
          body.members.map(
            (row): MemberListItem =>
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg ids stand in for Convex ids on the 0.4 wire shape
              ({
                _id: row.id,
                organizationId: row.organizationId,
                userId: row.userId,
                role: row.role,
                createdAt: Date.parse(row.createdAt) || 0,
                ...(row.displayName !== null
                  ? { displayName: row.displayName }
                  : {}),
                ...(row.email !== null ? { email: row.email } : {}),
                twoFactorEnabled: row.twoFactorEnabled,
                passkeyCount: row.passkeyCount,
              }) as MemberListItem,
          ),
        ),
    };
  },
  'documents/records:getPendingDocumentRecordReview': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const documentId = args.documentId;
    if (orgId === undefined || typeof documentId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'document', 'pending-review', documentId),
      queryFn: () =>
        backendFetch<{ review: PendingRecordReviewResult }>(
          `/documents/${encodeURIComponent(documentId)}/record/pending-review`,
          { orgId },
        ).then((body) => body.review),
    };
  },
  'documents/records:getLastDocumentRecordReview': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const documentId = args.documentId;
    if (orgId === undefined || typeof documentId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'document', 'last-review', documentId),
      queryFn: () =>
        backendFetch<{ review: LastRecordReviewResult }>(
          `/documents/${encodeURIComponent(documentId)}/record/last-review`,
          { orgId },
        ).then((body) => body.review),
    };
  },
  'documents/records:listEligibleDocumentReviewerIds': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const documentId = args.documentId;
    if (orgId === undefined || typeof documentId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'document', 'eligible-reviewers', documentId),
      queryFn: () =>
        backendFetch<{ userIds: string[] }>(
          `/documents/${encodeURIComponent(documentId)}/record/eligible-reviewer-ids`,
          { orgId },
        ).then((body) => body.userIds),
    };
  },
  'folders/queries:listFolders': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const parentId =
      typeof args.parentId === 'string' ? args.parentId : undefined;
    return hubFoldersQuery(orgId, parentId);
  },
  'folders/queries:getFolder': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const folderId = args.folderId;
    if (orgId === undefined || typeof folderId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'folder', 'detail', folderId),
      queryFn: () =>
        backendFetch<{ folder: FolderWire | null }>(
          `/folders/${encodeURIComponent(folderId)}`,
          { orgId },
        ).then((body): GetFolderResult => {
          if (body.folder === null) return null;
          const row = body.folder;
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg ids stand in for Convex ids on the 0.4 wire shape
          return {
            _id: row.id,
            name: row.name,
            teamId: row.teamId ?? undefined,
            parentId: row.parentId ?? undefined,
            organizationId: row.organizationId,
            projectId: row.projectId ?? undefined,
          } as GetFolderResult;
        }),
    };
  },
  'projects/queries:listProjectDocuments': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const projectId = args.projectId;
    if (orgId === undefined || typeof projectId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'document', 'by-project', projectId),
      queryFn: () =>
        backendFetch<{ documents: DocumentItemWire[] }>(
          `/documents/by-project/${encodeURIComponent(projectId)}`,
          { orgId },
        ).then(
          (body) => body.documents.map(projectDocumentView),
          (error: unknown) => {
            // 0.4 answers [] for a missing/inaccessible project.
            if (
              error instanceof BackendApiError &&
              (error.status === 404 || error.status === 403)
            ) {
              return [];
            }
            throw error;
          },
        ),
    };
  },
  'projects/queries:listProjectFolders': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const projectId = args.projectId;
    if (orgId === undefined || typeof projectId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'folder', 'by-project', projectId),
      queryFn: () =>
        backendFetch<{ folders: FolderWire[] }>(
          `/folders?projectId=${encodeURIComponent(projectId)}`,
          { orgId },
        ).then(
          (body) =>
            body.folders.map(
              (row): ProjectFolderItem =>
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg ids stand in for Convex ids on the 0.4 wire shape
                ({
                  _id: row.id,
                  name: row.name,
                  ...(row.parentId !== null ? { parentId: row.parentId } : {}),
                }) as ProjectFolderItem,
            ),
          (error: unknown) => {
            if (
              error instanceof BackendApiError &&
              (error.status === 404 || error.status === 403)
            ) {
              return [];
            }
            throw error;
          },
        ),
    };
  },
};

// ---------------------------------------------------------------------------
// Paginated adapter (the hub table's infinite listing)
// ---------------------------------------------------------------------------

/** The hub page walk's options — exported so a loader could prefetch the
 * first page under the same key. */
export function hubDocumentsPageQuery(
  orgId: string,
  filters: { folderId?: string; sourceProvider?: string; extension?: string },
): AdaptedPaginatedOptions {
  return {
    queryKey: backendKey(
      orgId,
      'document',
      'paginated',
      filters.folderId ?? null,
      filters.sourceProvider ?? null,
      filters.extension ?? null,
    ),
    fetchPage: (cursor, numItems) => {
      const query = new URLSearchParams({ numItems: String(numItems) });
      if (cursor !== null) query.set('cursor', cursor);
      if (filters.folderId !== undefined) {
        query.set('folderId', filters.folderId);
      }
      if (filters.sourceProvider !== undefined) {
        query.set('sourceProvider', filters.sourceProvider);
      }
      if (filters.extension !== undefined) {
        query.set('extension', filters.extension);
      }
      return backendFetch<{
        page: DocumentItem[];
        isDone: boolean;
        continueCursor: string;
      }>(`/documents/paginated?${query.toString()}`, { orgId });
    },
  };
}

export const documentPaginatedAdapters: Record<string, PaginatedAdapter> = {
  'documents/queries:listDocumentsPaginated': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return hubDocumentsPageQuery(orgId, {
      ...(typeof args.folderId === 'string' ? { folderId: args.folderId } : {}),
      ...(typeof args.sourceProvider === 'string'
        ? { sourceProvider: args.sourceProvider }
        : {}),
      ...(typeof args.extension === 'string'
        ? { extension: args.extension }
        : {}),
    });
  },
};

// ---------------------------------------------------------------------------
// Write adapters
// ---------------------------------------------------------------------------

function invalidateDocuments(
  client: QueryClient,
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'document'),
  });
}

function invalidateFolders(
  client: QueryClient,
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'folder'),
  });
  // Folder team changes cascade to member documents; a folder delete
  // removes its documents — refresh both families.
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'document'),
  });
}

function requireOrg(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) {
    throw new Error('No active organization for adapted write');
  }
  return orgId;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${key} for adapted write`);
  }
  return value;
}

export const documentWriteAdapters: Record<string, WriteAdapter> = {
  'documents/mutations:updateDocument': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const documentId = stringArg(args, 'documentId');
      return backendFetch<{ ok: boolean }>(
        `/documents/${encodeURIComponent(documentId)}`,
        {
          orgId,
          body: {
            ...(args.title !== undefined ? { title: args.title } : {}),
            ...(args.teamIds !== undefined ? { teamIds: args.teamIds } : {}),
          },
        },
      ).then(() => null);
    },
    invalidate: invalidateDocuments,
  },
  'documents/mutations:deleteDocument': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const documentId = stringArg(args, 'documentId');
      return backendFetch<{ ok: boolean }>(
        `/documents/${encodeURIComponent(documentId)}/delete`,
        { orgId, body: {} },
      ).then(() => null);
    },
    invalidate: invalidateDocuments,
  },
  'documents/mutations:createDocumentFromUpload': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      // The 0.4 mutation takes the BLOB REF as `fileId`; the pg bind route
      // registers the metadata row itself (`storageRef`).
      const storageRef = stringArg(args, 'fileId');
      return backendFetch<{ success: boolean; documentId: string }>(
        '/documents/from-blob-upload',
        {
          orgId,
          body: {
            storageRef,
            fileName: stringArg(args, 'fileName'),
            ...(typeof args.contentType === 'string'
              ? { contentType: args.contentType }
              : {}),
            ...(typeof args.contentHash === 'string'
              ? { contentHash: args.contentHash }
              : {}),
            ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
            ...(typeof args.teamId === 'string' ? { teamId: args.teamId } : {}),
            ...(typeof args.folderId === 'string'
              ? { folderId: args.folderId }
              : {}),
            ...(typeof args.projectId === 'string'
              ? { projectId: args.projectId }
              : {}),
            ...(args.skipRagIndexing === true ? { skipRagIndexing: true } : {}),
          },
        },
      );
    },
    invalidate: invalidateDocuments,
  },
  'documents/records:markControlled': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const documentId = stringArg(args, 'documentId');
      return backendFetch<{ ok: boolean }>(
        `/documents/${encodeURIComponent(documentId)}/record/mark-controlled`,
        { orgId, body: {} },
      ).then(() => null);
    },
    invalidate: invalidateDocuments,
  },
  'documents/records:submitRecordForReview': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const documentId = stringArg(args, 'documentId');
      return backendFetch<SubmitRecordResult>(
        `/documents/${encodeURIComponent(documentId)}/record/submit`,
        { orgId, body: { reviewerUserId: stringArg(args, 'reviewerUserId') } },
      );
    },
    invalidate: invalidateDocuments,
  },
  'documents/records:respondToDocumentRecordReview': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const approvalId = stringArg(args, 'approvalId');
      return backendFetch<RespondToRecordReviewResult>(
        `/documents/records/reviews/${encodeURIComponent(approvalId)}/respond`,
        {
          orgId,
          body: {
            decision: stringArg(args, 'decision'),
            ...(typeof args.feedback === 'string'
              ? { feedback: args.feedback }
              : {}),
          },
        },
      );
    },
    invalidate: invalidateDocuments,
  },
  'documents/records:openRecordRevision': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const documentId = stringArg(args, 'documentId');
      return backendFetch<{ version: number }>(
        `/documents/${encodeURIComponent(documentId)}/record/open-revision`,
        { orgId, body: {} },
      );
    },
    invalidate: invalidateDocuments,
  },
  'documents/actions:retryRagIndexing': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const documentId = stringArg(args, 'documentId');
      return backendFetch<{ success: boolean; error?: string }>(
        `/documents/${encodeURIComponent(documentId)}/retry-rag`,
        { orgId, body: {} },
      );
    },
    invalidate: invalidateDocuments,
  },
  'files/mutations:generateUploadUrl': {
    // The legacy POST lane: the 0.4 mutation answers an upload URL the
    // caller POSTs the file to and reads `{ storageId }` back. The pg twin
    // is `/files/upload`, whose `storageId` IS the org blob ref — so every
    // POST-lane uploader keeps working without per-component surgery.
    run: (args, ctx) =>
      Promise.resolve(backendUrl('/files/upload', requireOrg(args, ctx))),
  },
  'files/blob_actions:generateBlobUpload': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      return backendFetch<{ url: string; method: 'PUT'; s3Ref: string }>(
        '/files/blob-upload',
        {
          orgId,
          body:
            typeof args.contentType === 'string'
              ? { contentType: args.contentType }
              : {},
        },
      );
    },
  },
  'files/mutations:deleteRejectedUploadBlob': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      return backendFetch<{ deleted: boolean }>('/files/reject-blob', {
        orgId,
        body: { storageRef: stringArg(args, 'storageId') },
      });
    },
  },
  'folders/mutations:createFolder': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      return backendFetch<{ folderId: string }>('/folders', {
        orgId,
        body: {
          name: stringArg(args, 'name'),
          ...(typeof args.parentId === 'string'
            ? { parentId: args.parentId }
            : {}),
          ...(typeof args.teamId === 'string' ? { teamId: args.teamId } : {}),
          ...(typeof args.projectId === 'string'
            ? { projectId: args.projectId }
            : {}),
        },
      }).then((body) => body.folderId);
    },
    invalidate: invalidateFolders,
  },
  'folders/mutations:renameFolder': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const folderId = stringArg(args, 'folderId');
      return backendFetch<{ ok: boolean }>(
        `/folders/${encodeURIComponent(folderId)}/rename`,
        { orgId, body: { name: stringArg(args, 'name') } },
      ).then(() => null);
    },
    invalidate: invalidateFolders,
  },
  'folders/mutations:deleteFolder': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const folderId = stringArg(args, 'folderId');
      return backendFetch<{ ok: boolean }>(
        `/folders/${encodeURIComponent(folderId)}`,
        { orgId, method: 'DELETE' },
      ).then(() => null);
    },
    invalidate: invalidateFolders,
  },
  'folders/mutations:updateFolderTeams': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const folderId = stringArg(args, 'folderId');
      const teamIds = Array.isArray(args.teamIds) ? args.teamIds : [];
      return backendFetch<{ ok: boolean }>(
        `/folders/${encodeURIComponent(folderId)}/teams`,
        { orgId, body: { teamIds } },
      ).then(() => null);
    },
    invalidate: invalidateFolders,
  },
};
