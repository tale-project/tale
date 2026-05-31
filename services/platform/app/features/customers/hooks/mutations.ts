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
import type { Doc } from '@/convex/_generated/dataModel';

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
      // One merge function, reused for both the array and paginated views so a
      // field added to `updateCustomer` only has to be wired here once.
      const applyEdits = (customer: Doc<'customers'>): Doc<'customers'> => {
        const next = { ...customer };
        if (args.name !== undefined) next.name = args.name;
        if (args.email !== undefined) next.email = args.email;
        if (args.externalId !== undefined) next.externalId = args.externalId;
        if (args.status !== undefined) next.status = args.status;
        if (args.source !== undefined) next.source = args.source;
        if (args.locale !== undefined) next.locale = args.locale;
        return next;
      };
      // Patch the row in place in every cached variant. An edit can change
      // fields that drive search/facet membership (name/email/status/…), so a
      // filtered view may briefly keep a row it no longer matches (or miss a
      // newly-matching one) — that resolves itself when the mutation settles and
      // Convex re-runs the affected queries. We intentionally don't re-evaluate
      // each variant's predicate client-side: that would mean duplicating the
      // server's filter logic, which the optimistic-update helpers explicitly
      // warn against guessing.
      updateItemInListQuery(
        store,
        api.customers.queries.listCustomers,
        args.customerId,
        applyEdits,
      );
      // Mirror the patch into the paginated view the customers table renders.
      updateItemInPaginatedQuery(
        store,
        api.customers.queries.listCustomersPaginated,
        args.customerId,
        applyEdits,
      );
    },
  });
}
