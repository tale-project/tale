import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useReactQuery } from '@/app/hooks/use-react-query';
import type { ItemOf } from '@/app/lib/backend/contract';

export type Document = ItemOf<'documents/queries:listDocuments'>;

export function useApproxDocumentCount(organizationId: string) {
  return useBackendQuery('documents/queries:approxCountDocuments', {
    organizationId,
  });
}

/**
 * The caller's upload-quota usage (used / limit bytes), so the desk can show
 * remaining space before an upload is rejected. `limited: false` when no
 * per-user volume quota applies — callers then render no meter.
 */
export function useUploadUsage(organizationId: string) {
  return useBackendQuery('documents/queries:getUploadUsage', {
    organizationId,
  });
}

/** Cloud-import grant for the signed-in member (Microsoft or Google). */
export function useCloudImportAuthorizationStatus(
  organizationId: string,
  enabled: boolean,
  provider: 'onedrive' | 'google-drive' = 'onedrive',
) {
  return useBackendQuery(
    'cloud_import/queries:getAuthorizationStatus',
    enabled ? { organizationId, provider } : 'skip',
  );
}

export function useDocuments(
  organizationId: string,
  options?: { enabled?: boolean },
) {
  const { data, isLoading } = useBackendQuery(
    'documents/queries:listDocuments',
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
  return useBackendQuery(
    'documents/queries:getDocumentById',
    documentId && organizationId
      ? { documentId: documentId, organizationId }
      : 'skip',
  );
}

/** Version list (current + historyFiles) for the History dialog. */
export function useDocumentVersions(documentId: string | undefined) {
  const organizationId = useOrganizationId();
  return useBackendQuery(
    'documents/queries:listDocumentVersions',
    documentId && organizationId
      ? { documentId: documentId, organizationId }
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
  return useBackendQuery(
    'documents/queries:getDocumentByExternalItemId',
    enabled && externalItemId && organizationId
      ? {
          organizationId,
          externalItemId,
          ...(options?.projectId ? { projectId: options.projectId } : {}),
        }
      : 'skip',
  );
}

export function useFolder(folderId: string | undefined) {
  const organizationId = useOrganizationId();
  return useBackendQuery(
    'folders/queries:getFolder',
    folderId && organizationId
      ? { folderId: folderId, organizationId }
      : 'skip',
  );
}

export function useFolders(organizationId: string, parentFolderId?: string) {
  return useBackendQuery('folders/queries:listFolders', {
    organizationId,
    parentId: parentFolderId ? parentFolderId : undefined,
  });
}

export function useOneDriveFiles(
  organizationId: string,
  folderId: string | undefined,
  enabled: boolean,
) {
  const listOneDriveFiles = useBackendAction('onedrive/actions:listFiles');

  return useReactQuery({
    queryKey: ['onedrive-items', organizationId, folderId],
    queryFn: async () => {
      const result = await listOneDriveFiles.mutateAsync({
        organizationId,
        folderId,
      });
      if (!result.success || !result.items) {
        throw new Error(result.error || 'Failed to load OneDrive files');
      }
      // `truncated` rides along: the picker must say when a folder holds
      // more than the listing bound instead of showing a shorter folder.
      return { items: result.items, truncated: result.truncated ?? false };
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

export function useGoogleDriveFiles(
  organizationId: string,
  folderId: string | undefined,
  enabled: boolean,
) {
  const listGoogleDriveFiles = useBackendAction(
    'google_drive/actions:listFiles',
  );

  return useReactQuery({
    queryKey: ['google-drive-items', organizationId, folderId],
    queryFn: async () => {
      const result = await listGoogleDriveFiles.mutateAsync({
        organizationId,
        folderId,
      });
      if (!result.success || !result.items) {
        throw new Error(result.error || 'Failed to load Google Drive files');
      }
      return result.items;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

export function useSharePointSites(organizationId: string, enabled: boolean) {
  const listSharePointSites = useBackendAction(
    'onedrive/actions:listSharePointSites',
  );

  return useReactQuery({
    queryKey: ['sharepoint-sites', organizationId],
    queryFn: async () => {
      const result = await listSharePointSites.mutateAsync({ organizationId });
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
  organizationId: string,
  siteId: string | undefined,
  enabled: boolean,
) {
  const listSharePointDrives = useBackendAction(
    'onedrive/actions:listSharePointDrives',
  );

  return useReactQuery({
    queryKey: ['sharepoint-drives', organizationId, siteId],
    queryFn: async () => {
      if (!siteId) throw new Error('No site selected');
      const result = await listSharePointDrives.mutateAsync({
        organizationId,
        siteId,
      });
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
    'documents/queries:listDocumentsPaginated',
    {
      ...queryArgs,
      folderId: folderId ? folderId : undefined,
    },
    { initialNumItems },
  );
}

export function useSharePointFiles(
  organizationId: string,
  siteId: string | undefined,
  driveId: string | undefined,
  folderId: string | undefined,
  enabled: boolean,
) {
  const listSharePointFiles = useBackendAction(
    'onedrive/actions:listSharePointFiles',
  );

  return useReactQuery({
    queryKey: ['sharepoint-files', organizationId, siteId, driveId, folderId],
    queryFn: async () => {
      if (!siteId || !driveId) throw new Error('No site/drive selected');
      const result = await listSharePointFiles.mutateAsync({
        organizationId,
        siteId,
        driveId,
        folderId,
      });
      if (!result.success || !result.items) {
        throw new Error(result.error || 'Failed to load SharePoint files');
      }
      return { items: result.items, truncated: result.truncated ?? false };
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
  return useBackendQuery(
    'documents/records:getPendingDocumentRecordReview',
    documentId ? { documentId: documentId } : 'skip',
  );
}

/**
 * Members who could actually respond to a review on this document — the
 * submit dialog's picker filter (server-derived; documents/records.ts owns
 * the rule). Subscribed only while that dialog is open.
 */
export function useEligibleDocumentReviewerIds(documentId: string) {
  return useBackendQuery('documents/records:listEligibleDocumentReviewerIds', {
    documentId: documentId,
  });
}

/**
 * The latest completed review decision on a document — the submit dialog's
 * "changes requested by …" callout before a re-submit.
 */
export function useLastDocumentRecordReview(documentId: string) {
  return useBackendQuery('documents/records:getLastDocumentRecordReview', {
    documentId: documentId,
  });
}
