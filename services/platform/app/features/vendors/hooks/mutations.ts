import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useBulkCreateVendors() {
  return useConvexMutation(api.vendors.mutations.bulkCreateVendors);
}

export function useDeleteVendor() {
  const { mutateAsync } = useConvexMutation(api.vendors.mutations.deleteVendor);
  return mutateAsync;
}

export function useUpdateVendor() {
  const { mutateAsync } = useConvexMutation(api.vendors.mutations.updateVendor);
  return mutateAsync;
}
