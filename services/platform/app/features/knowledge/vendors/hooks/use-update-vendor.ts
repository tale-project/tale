import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpdateVendor(organizationId: string) {
  return useMutation(api.vendors.updateVendor).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.vendors.getAllVendors, {
        organizationId,
      });

      if (current !== undefined) {
        const updated = current.map((vendor) =>
          vendor._id === args.vendorId
            ? {
                ...vendor,
                ...(args.name !== undefined && { name: args.name }),
                ...(args.email !== undefined && { email: args.email }),
                ...(args.locale !== undefined && { locale: args.locale }),
              }
            : vendor,
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
