import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { sessionsApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';

import type { SessionChoice } from '../lib/session-choices';

/** The most sessions one request returns. */
export const SESSION_CHOICES_LIMIT = 500;

const NO_CHOICES: SessionChoice[] = [];

/**
 * The sessions a secret can be for, newest first, as many as one request
 * returns. `total` is the number of sessions there are, so a picker can say
 * when it shows only some. The list is kept for 30 seconds so that a form
 * opened again at once does not ask again; a write to a session makes it stale
 * at once (`useSessionActions`).
 */
export function useSessionChoices() {
  const query = useQuery({
    queryKey: queryKeys.sessionChoices,
    queryFn: ({ signal }) =>
      sessionsApi.list({ limit: SESSION_CHOICES_LIMIT }, { signal }),
    staleTime: 30_000,
  });
  const items = query.data?.items;
  const sessions = useMemo(
    () => items?.map(({ id, name }) => ({ id, name })) ?? NO_CHOICES,
    [items],
  );
  return {
    sessions,
    total: query.data?.total ?? 0,
    isPending: query.isPending,
    isError: query.isError,
  };
}
