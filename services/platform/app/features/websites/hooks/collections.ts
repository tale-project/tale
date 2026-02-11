import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Website } from '@/lib/collections/entities/websites';

import { createWebsitesCollection } from '@/lib/collections/entities/websites';
import { useCollection } from '@/lib/collections/use-collection';

export function useWebsiteCollection(organizationId: string) {
  return useCollection('websites', createWebsitesCollection, organizationId);
}

export function useWebsites(collection: Collection<Website, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ website: collection }).select(({ website }) => website),
  );

  return {
    websites: data,
    isLoading,
  };
}
