import { useQuery } from '@tanstack/react-query';

import { settingsApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';

/**
 * The app's settings. They change here, or through an assistant, rarely enough
 * that nothing polls them: the page reads them when it opens and again when the
 * window regains focus, and a change made elsewhere meanwhile reaches an open
 * draft as a remote update (see `useStartPageEditor`).
 */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => settingsApi.get({ signal }),
  });
}
