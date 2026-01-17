import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useDeleteCustomer(organizationId: string) {
  return useMutation(api.customers.deleteCustomer).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.customers.getAllCustomers, {
        organizationId,
      });

      if (current !== undefined) {
        const updated = current.filter(
          (customer) => customer._id !== args.customerId,
        );
        localStore.setQuery(
          api.customers.getAllCustomers,
          { organizationId },
          updated,
        );
      }
    },
  );
}
