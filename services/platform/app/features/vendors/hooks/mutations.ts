import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useBulkCreateVendors() {
  return useConvexMutation(api.vendors.mutations.bulkCreateVendors);
}

export function useDeleteVendor() {
  return useConvexMutation(api.vendors.mutations.deleteVendor);
}

export function useUpdateVendor() {
  return useConvexMutation(api.vendors.mutations.updateVendor);
}
