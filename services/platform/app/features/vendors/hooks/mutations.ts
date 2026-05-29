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

export function useBulkCreateVendors() {
  return useConvexMutation(api.vendors.mutations.bulkCreateVendors);
}

export function useDeleteVendor() {
  return useConvexMutation(api.vendors.mutations.deleteVendor, {
    // EntityDeleteDialog shows its own specific error toast.
    errorToast: false,
    optimisticUpdate: (store, args) => {
      removeItemFromListQuery(
        store,
        api.vendors.queries.listVendors,
        args.vendorId,
      );
      removeItemFromPaginatedQuery(
        store,
        api.vendors.queries.listVendorsPaginated,
        args.vendorId,
      );
    },
  });
}

export function useUpdateVendor() {
  return useConvexMutation(api.vendors.mutations.updateVendor, {
    // The edit dialog shows its own specific error toast.
    errorToast: false,
    optimisticUpdate: (store, args) => {
      updateItemInListQuery(
        store,
        api.vendors.queries.listVendors,
        args.vendorId,
        (vendor) => {
          const next = { ...vendor };
          if (args.name !== undefined) next.name = args.name;
          if (args.email !== undefined) next.email = args.email;
          if (args.phone !== undefined) next.phone = args.phone;
          if (args.externalId !== undefined) next.externalId = args.externalId;
          if (args.source !== undefined) next.source = args.source;
          if (args.locale !== undefined) next.locale = args.locale;
          return next;
        },
      );
      // Mirror the patch into the paginated view the vendors table renders.
      updateItemInPaginatedQuery(
        store,
        api.vendors.queries.listVendorsPaginated,
        args.vendorId,
        (vendor) => {
          const next = { ...vendor };
          if (args.name !== undefined) next.name = args.name;
          if (args.email !== undefined) next.email = args.email;
          if (args.phone !== undefined) next.phone = args.phone;
          if (args.externalId !== undefined) next.externalId = args.externalId;
          if (args.source !== undefined) next.source = args.source;
          if (args.locale !== undefined) next.locale = args.locale;
          return next;
        },
      );
    },
  });
}
