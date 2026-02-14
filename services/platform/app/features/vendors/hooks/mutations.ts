import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexOptimisticMutation } from '@/app/hooks/use-convex-optimistic-mutation';
import { api } from '@/convex/_generated/api';

export function useBulkCreateVendors() {
  return useConvexMutation(api.vendors.mutations.bulkCreateVendors, {
    invalidates: [api.vendors.queries.listVendors],
  });
}

export function useDeleteVendor() {
  return useConvexOptimisticMutation(
    api.vendors.mutations.deleteVendor,
    api.vendors.queries.listVendors,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ vendorId }, { remove }) => remove(vendorId),
    },
  );
}

export function useUpdateVendor() {
  return useConvexOptimisticMutation(
    api.vendors.mutations.updateVendor,
    api.vendors.queries.listVendors,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ vendorId, ...changes }, { update }) =>
        update(vendorId, changes),
    },
  );
}
