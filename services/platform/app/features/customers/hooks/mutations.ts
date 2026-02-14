import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexOptimisticMutation } from '@/app/hooks/use-convex-optimistic-mutation';
import { api } from '@/convex/_generated/api';

export function useBulkCreateCustomers() {
  return useConvexMutation(api.customers.mutations.bulkCreateCustomers, {
    invalidates: [api.customers.queries.listCustomers],
  });
}

export function useDeleteCustomer() {
  return useConvexOptimisticMutation(
    api.customers.mutations.deleteCustomer,
    api.customers.queries.listCustomers,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ customerId }, { remove }) => remove(customerId),
    },
  );
}

export function useUpdateCustomer() {
  return useConvexOptimisticMutation(
    api.customers.mutations.updateCustomer,
    api.customers.queries.listCustomers,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ customerId, ...changes }, { update }) =>
        update(customerId, changes),
    },
  );
}
