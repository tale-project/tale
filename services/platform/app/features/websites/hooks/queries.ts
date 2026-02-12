import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Website } from '@/lib/collections/entities/websites';

export function useWebsites(collection: Collection<Website, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ website: collection }).select(({ website }) => website),
  );

  return {
    websites: data,
    isLoading,
  };
}
