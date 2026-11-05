import { queryOptions, useQuery } from '@tanstack/react-query';

import { settingsApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';

/**
 * The read of the settings, under the one key the hook and the Settings
 * route's loader share: the loader has them in before the page's first frame
 * (see `routes/settings.tsx`).
 */
export function settingsQuery() {
  return queryOptions({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => settingsApi.get({ signal }),
  });
}

/**
 * The app's settings. They change here, or through an assistant, rarely enough
 * that nothing polls them: the page reads them when it opens and again when the
 * window regains focus, and a change made elsewhere meanwhile reaches an open
 * draft as a remote update (see `useStartPageEditor`).
 */
export function useSettings() {
  return useQuery(settingsQuery());
}
