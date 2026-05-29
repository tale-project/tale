import {
  removeItemFromListQuery,
  updateItemInListQuery,
} from '@/app/hooks/optimistic-updates';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import {
  removeItemFromPaginatedQuery,
  updateItemInPaginatedQuery,
} from '@/app/hooks/use-convex-paginated-query';
import { api } from '@/convex/_generated/api';

export function useBulkCreateCustomers() {
  return useConvexMutation(api.customers.mutations.bulkCreateCustomers);
}

export function useDeleteCustomer() {
  return useConvexMutation(api.customers.mutations.deleteCustomer, {
    // EntityDeleteDialog shows its own specific error toast.
    errorToast: false,
    optimisticUpdate: (store, args) => {
      removeItemFromListQuery(
        store,
        api.customers.queries.listCustomers,
        args.customerId,
      );
      removeItemFromPaginatedQuery(
        store,
        api.customers.queries.listCustomersPaginated,
        args.customerId,
      );
    },
  });
}

export function useUpdateCustomer() {
  return useConvexMutation(api.customers.mutations.updateCustomer, {
    // The edit dialog shows its own specific error toast.
    errorToast: false,
    optimisticUpdate: (store, args) => {
      updateItemInListQuery(
        store,
        api.customers.queries.listCustomers,
        args.customerId,
        (customer) => {
          const next = { ...customer };
          if (args.name !== undefined) next.name = args.name;
          if (args.email !== undefined) next.email = args.email;
          if (args.externalId !== undefined) next.externalId = args.externalId;
          if (args.status !== undefined) next.status = args.status;
          if (args.source !== undefined) next.source = args.source;
          if (args.locale !== undefined) next.locale = args.locale;
          return next;
        },
      );
      // Mirror the patch into the paginated view the customers table renders.
      updateItemInPaginatedQuery(
        store,
        api.customers.queries.listCustomersPaginated,
        args.customerId,
        (customer) => {
          const next = { ...customer };
          if (args.name !== undefined) next.name = args.name;
          if (args.email !== undefined) next.email = args.email;
          if (args.externalId !== undefined) next.externalId = args.externalId;
          if (args.status !== undefined) next.status = args.status;
          if (args.source !== undefined) next.source = args.source;
          if (args.locale !== undefined) next.locale = args.locale;
          return next;
        },
      );
    },
  });
}
