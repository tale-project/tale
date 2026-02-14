import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useBulkCreateCustomers() {
  return useConvexMutation(api.customers.mutations.bulkCreateCustomers);
}

export function useDeleteCustomer() {
  return useConvexMutation(api.customers.mutations.deleteCustomer);
}

export function useUpdateCustomer() {
  return useConvexMutation(api.customers.mutations.updateCustomer);
}
