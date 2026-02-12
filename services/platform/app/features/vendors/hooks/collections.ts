import { createVendorsCollection } from '@/lib/collections/entities/vendors';
import { useCollection } from '@/lib/collections/use-collection';

export function useVendorCollection(organizationId: string) {
  return useCollection('vendors', createVendorsCollection, organizationId);
}
