import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpdateCustomer(organizationId: string) {
  return useMutation(api.customers.updateCustomer).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.customers.getAllCustomers, {
        organizationId,
      });

      if (current !== undefined) {
        const updated = current.map((customer) =>
          customer._id === args.customerId
            ? {
                ...customer,
                ...(args.name !== undefined && { name: args.name }),
                ...(args.email !== undefined && { email: args.email }),
                ...(args.locale !== undefined && { locale: args.locale }),
              }
            : customer,
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
