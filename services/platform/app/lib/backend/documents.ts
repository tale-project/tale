/**
 * Documents vertical over the 0.5 backend — the Knowledge Hub (documents +
 * folders), the project Files tab, and the session upload lane. Response
 * types are DERIVED from the 0.4 function signatures (`FunctionReturnType`);
 * the backend already serves the 0.4 `DocumentItemResponse` view (rag
 * projection, presigned urls, creator names, record badge), so most reads
 * pass through, and the folder rows get their `id` → `_id` projection here.
 */

import type { QueryClient } from '@tanstack/react-query';

import type { ItemOf, ReturnsOf } from '@/app/lib/backend/contract';

import type {
  ActionQueryAdapter,
  AdaptedPaginatedOptions,
  AdapterContext,
  PaginatedAdapter,
  ReadAdapter,
  WriteAdapter,
} from './adapters';
import { BackendApiError, backendFetch, backendUrl } from './api-client';
import { backendEntityPrefix, backendKey } from './query-keys';

// ---------------------------------------------------------------------------
// Wire rows + 0.4-shape projections
// ---------------------------------------------------------------------------

type DocumentItem = ItemOf<'documents/queries:listDocuments'>;
type DocumentVersionsResult =
  ReturnsOf<'documents/queries:listDocumentVersions'>;
type DocumentByExternalIdResult =
  ReturnsOf<'documents/queries:getDocumentByExternalItemId'>;
type UploadUsageResult = ReturnsOf<'documents/queries:getUploadUsage'>;
type DocumentSearchHit = ItemOf<'documents/search:searchDocuments'>;
type ProjectDocumentItem = ItemOf<'projects/queries:listProjectDocuments'>;
type PendingRecordReviewResult =
  ReturnsOf<'documents/records:getPendingDocumentRecordReview'>;
type LastRecordReviewResult =
  ReturnsOf<'documents/records:getLastDocumentRecordReview'>;
type RespondToRecordReviewResult =
  ReturnsOf<'documents/records:respondToDocumentRecordReview'>;
type SubmitRecordResult = ReturnsOf<'documents/records:submitRecordForReview'>;
type MemberListItem = ItemOf<'members/queries:listByOrganization'>;

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
type ProjectFolderItem = ItemOf<'projects/queries:listProjectFolders'>;
type FolderDoc = NonNullable<ReturnsOf<'folders/queries:listFolders'>>[number];
type GetFolderResult = ReturnsOf<'folders/queries:getFolder'>;

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
  };
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

/** A string arg off the 0.4 call site; the empty folder name is legal. */
function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value : '';
}

type FileStatusResult = ReturnsOf<'file_metadata/queries:getByStorageIds'>;

type EnsureProjectTextResult =
  ReturnsOf<'documents/public_actions:ensureProjectTextDocument'>;

export const documentReadAdapters: Record<string, ReadAdapter> = {
  // Attachment pipeline statuses — the same row the chat seam serves, here
  // for every OTHER surface that renders an attachment (task files, the
  // conversation composer and message list).
  'files/queries:getFileUrl': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const fileId = textArg(args, 'fileId');
    if (fileId === '') return null;
    return {
      queryKey: backendKey(orgId, 'file', 'url', fileId),
      queryFn: () =>
        backendFetch<{ url: string | null }>(
          `/files/${encodeURIComponent(fileId)}/url`,
          { orgId },
        )
          .then((body) => body.url)
          // A blob the caller cannot resolve reads as `null` — the 0.4
          // query's answer, which every consumer already renders as "no
          // preview" rather than an error.
          .catch(() => null),
    };
  },
  'files/queries:getFileUrls': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const fileIds = Array.isArray(args.fileIds)
      ? args.fileIds.filter((id): id is string => typeof id === 'string')
      : [];
    if (fileIds.length === 0) return null;
    return {
      queryKey: backendKey(
        orgId,
        'file',
        'urls',
        [...fileIds].sort().join(','),
      ),
      queryFn: () =>
        backendFetch<{ urls: { fileId: string; url: string | null }[] }>(
          '/files/urls',
          { orgId, body: { fileIds } },
        ).then((body) => body.urls),
    };
  },
  'folders/queries:getFolderBreadcrumb': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const folderId = textArg(args, 'folderId');
    if (folderId === '') return null;
    return {
      queryKey: backendKey(orgId, 'folder', 'breadcrumb', folderId),
      queryFn: () =>
        backendFetch<{ breadcrumb: unknown }>(
          `/folders/${encodeURIComponent(folderId)}/breadcrumb`,
          { orgId },
        ).then((body) => body.breadcrumb),
    };
  },
  'file_metadata/queries:getByStorageIds': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const storageIds = Array.isArray(args.storageIds)
      ? args.storageIds.filter((id): id is string => typeof id === 'string')
      : [];
    return {
      queryKey: backendKey(
        orgId,
        'file_status',
        [...storageIds].sort().join(','),
      ),
      // One-shot: the pipeline hooks that need to WATCH a staging file poll
      // through their own query with its interval.
      queryFn: () =>
        backendFetch<{ statuses: FileStatusResult }>('/files/statuses', {
          method: 'POST',
          body: { storageIds },
          orgId,
        }).then((body) => body.statuses),
    };
  },
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
  'cloud_import/queries:getAuthorizationStatus': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const provider = args.provider;
    if (orgId === undefined || typeof provider !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'cloud_authorization', 'status', provider),
      queryFn: () =>
        backendFetch<{
          authorizations: {
            provider: string;
            status: 'active' | 'needs-reauth' | 'revoked';
            scopes: string[];
            accountLabel: string | null;
          }[];
        }>('/cloud-import/authorizations', { orgId }).then((body) => {
          const row = body.authorizations.find(
            (auth) => auth.provider === provider,
          );
          if (row === undefined) return null;
          return {
            status: row.status,
            ...(row.accountLabel !== null
              ? { accountLabel: row.accountLabel }
              : {}),
            scopes: row.scopes,
          };
        }),
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
          };
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

/** The automation settings panel's file pair (both are 0.4 ACTIONS). */
export const documentActionQueryAdapters: Record<string, ActionQueryAdapter> = {
  'documents/public_actions:readProjectTextValues': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return () =>
      backendFetch<{ values: Record<string, string> }>(
        '/documents/project-text/read',
        {
          orgId,
          body: {
            projectId: textArg(args, 'projectId'),
            folderName: textArg(args, 'folderName'),
            fileName: textArg(args, 'fileName'),
          },
        },
      ).then((body) => body.values);
  },
};

export const documentWriteAdapters: Record<string, WriteAdapter> = {
  /**
   * Document comparison is OFFLINE in 0.4 too — the action runs its gates
   * and then refuses with this exact message, which the comparison view
   * shows. Answering it here keeps that behaviour after cutover instead of
   * leaving the button on a lane that will not exist.
   */
  'documents/compare_documents:compareDocuments': {
    run: () =>
      Promise.reject(
        new BackendApiError(
          400,
          'Document comparison is offline while the platform AI backend is rewritten.',
          'COMPARISON_OFFLINE',
        ),
      ),
  },
  'projects/mutations:detachDocumentFromProject': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/documents/${encodeURIComponent(textArg(args, 'documentId'))}/detach-from-project`,
        { orgId: requireOrg(args, ctx), body: {} },
      ).then(() => null),
    invalidate: invalidateDocuments,
  },
  'file_metadata/mutations:saveFileMetadata': {
    run: (args, ctx) =>
      backendFetch<{ fileId: string }>('/files/register', {
        orgId: requireOrg(args, ctx),
        body: {
          storageRef: textArg(args, 'storageId'),
          fileName: textArg(args, 'fileName'),
          contentType: textArg(args, 'contentType'),
          ...(typeof args.threadId === 'string'
            ? { threadId: args.threadId }
            : {}),
          ...(typeof args.source === 'string' ? { source: args.source } : {}),
        },
      }).then((body) => body.fileId),
  },
  'file_metadata/mutations:skipTranscription': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/files/transcription/skip', {
        orgId: requireOrg(args, ctx),
        body: { storageRef: textArg(args, 'storageId') },
      }).then(() => null),
  },
  'file_metadata/mutations:retryTranscription': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/files/transcription/retry', {
        orgId: requireOrg(args, ctx),
        body: { storageRef: textArg(args, 'storageId') },
      }).then(() => null),
  },
  'documents/public_actions:ensureProjectTextDocument': {
    run: (args, ctx) => {
      const orgId = orgOf(args, ctx);
      if (orgId === undefined) {
        throw new Error('ensureProjectTextDocument needs an organization');
      }
      return backendFetch<EnsureProjectTextResult>('/documents/project-text', {
        orgId,
        body: {
          projectId: textArg(args, 'projectId'),
          folderName: textArg(args, 'folderName'),
          fileName: textArg(args, 'fileName'),
          ...(typeof args.content === 'string'
            ? { content: args.content }
            : {}),
          ...(args.yaml !== undefined && args.yaml !== null
            ? { yaml: args.yaml }
            : {}),
          ...(typeof args.contentType === 'string'
            ? { contentType: args.contentType }
            : {}),
          ...(typeof args.externalItemId === 'string'
            ? { externalItemId: args.externalItemId }
            : {}),
        },
      });
    },
  },
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
  'documents/record_actions:beginControlledDocumentReplacementUpload': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const documentId = stringArg(args, 'documentId');
      return backendFetch<{
        intentId: string;
        url: string;
        method: 'PUT';
        uploadContentType: string;
        uploadExpiresAt: number;
      }>(
        `/documents/${encodeURIComponent(documentId)}/replacement-upload/begin`,
        {
          orgId,
          body: {
            expectedRecordState: stringArg(args, 'expectedRecordState'),
            expectedVersion: args.expectedVersion,
            expectedFileId: stringArg(args, 'expectedFileId'),
            fileName: stringArg(args, 'fileName'),
            ...(typeof args.contentType === 'string'
              ? { contentType: args.contentType }
              : {}),
            ...(typeof args.lastModified === 'number'
              ? { lastModified: args.lastModified }
              : {}),
          },
        },
      );
    },
  },
  'documents/record_actions:finalizeControlledDocumentReplacementUpload': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const intentId = stringArg(args, 'intentId');
      return backendFetch<{ version: number }>(
        `/documents/replacement-uploads/${encodeURIComponent(intentId)}/finalize`,
        { orgId, body: {} },
      );
    },
    invalidate: invalidateDocuments,
  },
  'documents/record_actions:reconcileControlledDocumentReplacementUpload': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const intentId = stringArg(args, 'intentId');
      return backendFetch<{
        state: string;
        resultVersion?: number;
        cleanupPending: boolean;
        lastError?: string;
        updatedAt: number;
      }>(
        `/documents/replacement-uploads/${encodeURIComponent(intentId)}/status`,
        { orgId },
      );
    },
    invalidate: invalidateDocuments,
  },
  'documents/replacement_uploads:cancelControlledDocumentReplacementUpload': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const intentId = stringArg(args, 'intentId');
      return backendFetch<{
        state: 'bound' | 'cancelled';
        resultVersion?: number;
      }>(
        `/documents/replacement-uploads/${encodeURIComponent(intentId)}/cancel`,
        { orgId, body: {} },
      );
    },
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
  // --- Cloud import (list/import/sync-cancel/revoke ride the pg doors) ----
  'onedrive/actions:listFiles': {
    run: (args, ctx) =>
      backendFetch('/onedrive/list-files', {
        orgId: requireOrg(args, ctx),
        body: {
          ...(typeof args.folderId === 'string'
            ? { folderId: args.folderId }
            : {}),
          ...(typeof args.search === 'string' ? { search: args.search } : {}),
        },
      }),
  },
  'onedrive/actions:listSharePointSites': {
    run: (args, ctx) =>
      backendFetch('/onedrive/sharepoint/sites', {
        orgId: requireOrg(args, ctx),
        body: typeof args.search === 'string' ? { search: args.search } : {},
      }),
  },
  'onedrive/actions:listSharePointDrives': {
    run: (args, ctx) =>
      backendFetch('/onedrive/sharepoint/drives', {
        orgId: requireOrg(args, ctx),
        body: { siteId: stringArg(args, 'siteId') },
      }),
  },
  'onedrive/actions:listSharePointFiles': {
    run: (args, ctx) =>
      backendFetch('/onedrive/sharepoint/files', {
        orgId: requireOrg(args, ctx),
        body: {
          siteId: stringArg(args, 'siteId'),
          driveId: stringArg(args, 'driveId'),
          ...(typeof args.folderId === 'string'
            ? { folderId: args.folderId }
            : {}),
          ...(typeof args.search === 'string' ? { search: args.search } : {}),
        },
      }),
  },
  'onedrive/actions:importFiles': {
    run: (args, ctx) =>
      backendFetch('/onedrive/import', {
        orgId: requireOrg(args, ctx),
        body: {
          items: args.items,
          importType: stringArg(args, 'importType'),
          ...(typeof args.teamId === 'string' ? { teamId: args.teamId } : {}),
        },
      }),
    invalidate: invalidateDocuments,
  },
  'google_drive/actions:listFiles': {
    run: (args, ctx) =>
      backendFetch('/google-drive/list-files', {
        orgId: requireOrg(args, ctx),
        body: {
          ...(typeof args.folderId === 'string'
            ? { folderId: args.folderId }
            : {}),
          ...(typeof args.search === 'string' ? { search: args.search } : {}),
        },
      }),
  },
  'google_drive/actions:importFiles': {
    run: (args, ctx) =>
      backendFetch('/google-drive/import', {
        orgId: requireOrg(args, ctx),
        body: {
          items: args.items,
          importType: stringArg(args, 'importType'),
          ...(typeof args.teamId === 'string' ? { teamId: args.teamId } : {}),
        },
      }),
    invalidate: invalidateDocuments,
  },
  'onedrive/mutations:cancelSyncConfig': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/onedrive/sync-configs/${encodeURIComponent(stringArg(args, 'configId'))}/cancel`,
        { orgId: requireOrg(args, ctx), body: {} },
      ).then(() => null),
    invalidate: invalidateFolders,
  },
  'google_drive/mutations:cancelSyncConfig': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/google-drive/sync-configs/${encodeURIComponent(stringArg(args, 'configId'))}/cancel`,
        { orgId: requireOrg(args, ctx), body: {} },
      ).then(() => null),
    invalidate: invalidateFolders,
  },
  'cloud_import/mutations:revokeAuthorization': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      return backendFetch<{ ok: boolean }>(
        `/cloud-import/authorizations/${encodeURIComponent(stringArg(args, 'provider'))}/revoke`,
        { orgId, body: {} },
      ).then(() => null);
    },
    invalidate: (client, args, ctx) => {
      const orgId = orgOf(args, ctx);
      if (orgId === undefined) return;
      void client.invalidateQueries({
        queryKey: backendEntityPrefix(orgId, 'cloud_authorization'),
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
