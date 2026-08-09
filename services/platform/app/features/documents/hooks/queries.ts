import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useReactQuery } from '@/app/hooks/use-react-query';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import type { ConvexItemOf } from '@/lib/types/convex-helpers';

export type Document = ConvexItemOf<typeof api.documents.queries.listDocuments>;

export function useApproxDocumentCount(organizationId: string) {
  return useConvexQuery(api.documents.queries.approxCountDocuments, {
    organizationId,
  });
}

/**
 * The caller's upload-quota usage (used / limit bytes), so the desk can show
 * remaining space before an upload is rejected. `limited: false` when no
 * per-user volume quota applies — callers then render no meter.
 */
export function useUploadUsage(organizationId: string) {
  return useConvexQuery(api.documents.queries.getUploadUsage, {
    organizationId,
  });
}

export function useDocuments(
  organizationId: string,
  options?: { enabled?: boolean },
) {
  const { data, isLoading } = useConvexQuery(
    api.documents.queries.listDocuments,
    options?.enabled === false ? 'skip' : { organizationId },
  );

  return {
    documents: data ?? [],
    isLoading,
  };
}

/**
 * Point-query a single document by id (org/team access enforced server-side).
 * Use instead of pulling the whole collection to find one document. Pass
 * `undefined` to skip (e.g. dialog closed or only a storage id is available).
 */
export function useDocument(documentId: string | undefined) {
  const organizationId = useOrganizationId();
  return useConvexQuery(
    api.documents.queries.getDocumentById,
    documentId && organizationId
      ? { documentId: toId<'documents'>(documentId), organizationId }
      : 'skip',
  );
}

/** Version list (current + historyFiles) for the History dialog. */
export function useDocumentVersions(documentId: string | undefined) {
  const organizationId = useOrganizationId();
  return useConvexQuery(
    api.documents.queries.listDocumentVersions,
    documentId && organizationId
      ? { documentId: toId<'documents'>(documentId), organizationId }
      : 'skip',
  );
}

/** Resolve a document by stable externalItemId (Case Setup deep-links). */
export function useDocumentByExternalItemId(
  externalItemId: string | undefined,
  options?: { projectId?: string; enabled?: boolean },
) {
  const organizationId = useOrganizationId();
  const enabled = options?.enabled !== false;
  return useConvexQuery(
    api.documents.queries.getDocumentByExternalItemId,
    enabled && externalItemId && organizationId
      ? {
          organizationId,
          externalItemId,
          ...(options?.projectId
            ? { projectId: toId<'projects'>(options.projectId) }
            : {}),
        }
      : 'skip',
  );
}

export function useFolder(folderId: string | undefined) {
  const organizationId = useOrganizationId();
  return useConvexQuery(
    api.folders.queries.getFolder,
    folderId && organizationId
      ? { folderId: toId<'folders'>(folderId), organizationId }
      : 'skip',
  );
}

export function useFolders(organizationId: string, parentFolderId?: string) {
  return useConvexQuery(api.folders.queries.listFolders, {
    organizationId,
    parentId: parentFolderId ? toId<'folders'>(parentFolderId) : undefined,
  });
}

export function useOneDriveFiles(
  folderId: string | undefined,
  enabled: boolean,
) {
  const listOneDriveFiles = useConvexAction(api.onedrive.actions.listFiles);

  return useReactQuery({
    queryKey: ['onedrive-items', folderId],
    queryFn: async () => {
      const result = await listOneDriveFiles.mutateAsync({ folderId });
      if (!result.success || !result.items) {
        throw new Error(result.error || 'Failed to load OneDrive files');
      }
      return result.items;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

export function useSharePointSites(enabled: boolean) {
  const listSharePointSites = useConvexAction(
    api.onedrive.actions.listSharePointSites,
  );

  return useReactQuery({
    queryKey: ['sharepoint-sites'],
    queryFn: async () => {
      const result = await listSharePointSites.mutateAsync({});
      if (!result.success || !result.sites) {
        throw new Error(result.error || 'Failed to load SharePoint sites');
      }
      return result.sites;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

export function useSharePointDrives(
  siteId: string | undefined,
  enabled: boolean,
) {
  const listSharePointDrives = useConvexAction(
    api.onedrive.actions.listSharePointDrives,
  );

  return useReactQuery({
    queryKey: ['sharepoint-drives', siteId],
    queryFn: async () => {
      if (!siteId) throw new Error('No site selected');
      const result = await listSharePointDrives.mutateAsync({ siteId });
      if (!result.success || !result.drives) {
        throw new Error(result.error || 'Failed to load SharePoint drives');
      }
      return result.drives;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

interface ListDocumentsPaginatedArgs {
  organizationId: string;
  folderId?: string;
  sourceProvider?: string;
  extension?: string;
  initialNumItems: number;
}

export function useListDocumentsPaginated(args: ListDocumentsPaginatedArgs) {
  const { initialNumItems, folderId, ...queryArgs } = args;
  return useCachedPaginatedQuery(
    api.documents.queries.listDocumentsPaginated,
    {
      ...queryArgs,
      folderId: folderId ? toId<'folders'>(folderId) : undefined,
    },
    { initialNumItems },
  );
}

export function useSharePointFiles(
  siteId: string | undefined,
  driveId: string | undefined,
  folderId: string | undefined,
  enabled: boolean,
) {
  const listSharePointFiles = useConvexAction(
    api.onedrive.actions.listSharePointFiles,
  );

  return useReactQuery({
    queryKey: ['sharepoint-files', siteId, driveId, folderId],
    queryFn: async () => {
      if (!siteId || !driveId) throw new Error('No site/drive selected');
      const result = await listSharePointFiles.mutateAsync({
        siteId,
        driveId,
        folderId,
      });
      if (!result.success || !result.items) {
        throw new Error(result.error || 'Failed to load SharePoint files');
      }
      return result.items;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

/**
 * The live pending controlled-record review for a document (approval id +
 * who it waits on). `undefined` documentId skips the subscription — only the
 * review dialog fetches it.
 */
export function usePendingDocumentRecordReview(documentId: string | undefined) {
  return useConvexQuery(
    api.documents.records.getPendingDocumentRecordReview,
    documentId ? { documentId: toId<'documents'>(documentId) } : 'skip',
  );
}
