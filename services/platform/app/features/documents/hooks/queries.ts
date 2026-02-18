import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useReactQuery } from '@/app/hooks/use-react-query';
import { api } from '@/convex/_generated/api';

export type Document = ConvexItemOf<typeof api.documents.queries.listDocuments>;

export function useApproxDocumentCount(organizationId: string) {
  return useConvexQuery(api.documents.queries.approxCountDocuments, {
    organizationId,
  });
}

export function useDocuments(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.documents.queries.listDocuments,
    { organizationId },
  );

  return {
    documents: data ?? [],
    isLoading,
  };
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
  sourceProvider?: string;
  extension?: string;
  initialNumItems: number;
}

export function useListDocumentsPaginated(args: ListDocumentsPaginatedArgs) {
  const { initialNumItems, ...queryArgs } = args;
  return useCachedPaginatedQuery(
    api.documents.queries.listDocumentsPaginated,
    queryArgs,
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
