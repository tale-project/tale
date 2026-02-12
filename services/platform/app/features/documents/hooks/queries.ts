import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Document } from '@/lib/collections/entities/documents';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useReactQuery } from '@/app/hooks/use-react-query';
import { api } from '@/convex/_generated/api';

export function useDocuments(collection: Collection<Document, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ document: collection }).select(({ document }) => document),
  );

  return {
    documents: data,
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
      const result = await listOneDriveFiles({ folderId });
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
      const result = await listSharePointSites({});
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
      const result = await listSharePointDrives({ siteId });
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
      const result = await listSharePointFiles({
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
