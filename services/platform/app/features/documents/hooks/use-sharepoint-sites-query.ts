import { useQuery } from '@tanstack/react-query';

import { useListSharePointSites } from './queries';

export function useSharePointSitesQuery(enabled: boolean) {
  const listSharePointSites = useListSharePointSites();

  return useQuery({
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
