import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Vendor } from '@/lib/collections/entities/vendors';

import { createVendorsCollection } from '@/lib/collections/entities/vendors';
import { useCollection } from '@/lib/collections/use-collection';

export function useVendorCollection(organizationId: string) {
  return useCollection('vendors', createVendorsCollection, organizationId);
}

export function useVendors(collection: Collection<Vendor, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ vendor: collection }).select(({ vendor }) => vendor),
  );

  return {
    vendors: data,
    isLoading,
  };
}
