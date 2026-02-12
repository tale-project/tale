import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Vendor } from '@/lib/collections/entities/vendors';

export function useVendors(collection: Collection<Vendor, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ vendor: collection }).select(({ vendor }) => vendor),
  );

  return {
    vendors: data,
    isLoading,
  };
}
