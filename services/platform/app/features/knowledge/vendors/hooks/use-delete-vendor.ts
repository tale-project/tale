import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useDeleteVendor(organizationId: string) {
  return useMutation(api.vendors.deleteVendor).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.vendors.getAllVendors, {
        organizationId,
      });

      if (current !== undefined) {
        const updated = current.filter(
          (vendor) => vendor._id !== args.vendorId,
        );
        localStore.setQuery(
          api.vendors.getAllVendors,
          { organizationId },
          updated,
        );
      }
    },
  );
}
