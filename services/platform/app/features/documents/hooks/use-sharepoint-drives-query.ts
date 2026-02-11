import { useQuery } from '@tanstack/react-query';

import { useListSharePointDrives } from './queries';

export function useSharePointDrivesQuery(
  siteId: string | undefined,
  enabled: boolean,
) {
  const listSharePointDrives = useListSharePointDrives();

  return useQuery({
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
