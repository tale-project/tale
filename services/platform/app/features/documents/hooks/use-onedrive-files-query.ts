import { useQuery } from '@tanstack/react-query';

import { useListOneDriveFiles } from './queries';

export function useOneDriveFilesQuery(
  folderId: string | undefined,
  enabled: boolean,
) {
  const listOneDriveFiles = useListOneDriveFiles();

  return useQuery({
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
