import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useBulkCreateCustomers() {
  return useConvexMutation(api.customers.mutations.bulkCreateCustomers);
}

export function useDeleteCustomer() {
  const { mutateAsync } = useConvexMutation(
    api.customers.mutations.deleteCustomer,
  );
  return mutateAsync;
}

export function useUpdateCustomer() {
  const { mutateAsync } = useConvexMutation(
    api.customers.mutations.updateCustomer,
  );
  return mutateAsync;
}
