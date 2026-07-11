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

export function useBulkCreateContacts() {
  return useConvexMutation(api.contacts.mutations.bulkCreateContacts);
}

export function useCreateContact() {
  return useConvexMutation(api.contacts.mutations.createContact, {
    // The create dialog shows its own specific error toast (duplicate-email
    // vs generic) — see `useCreateProduct` for the same pattern.
    errorToast: false,
  });
}

export function useDeleteContact() {
  return useConvexMutation(api.contacts.mutations.deleteContact, {
    // EntityDeleteDialog shows its own specific error toast.
    errorToast: false,
    optimisticUpdate: (store, args) => {
      removeItemFromListQuery(
        store,
        api.contacts.queries.listContacts,
        args.contactId,
      );
      removeItemFromPaginatedQuery(
        store,
        api.contacts.queries.listContactsPaginated,
        args.contactId,
      );
    },
  });
}

export function useUpdateContact() {
  return useConvexMutation(api.contacts.mutations.updateContact, {
    // The edit dialog shows its own specific error toast.
    errorToast: false,
    optimisticUpdate: (store, args) => {
      // One merge function, reused for both the array and paginated views so a
      // field added to `updateContact` only has to be wired here once.
      const applyEdits = (contact: Doc<'contacts'>): Doc<'contacts'> => {
        const next = { ...contact };
        if (args.name !== undefined) next.name = args.name;
        if (args.email !== undefined) next.email = args.email;
        if (args.phone !== undefined) next.phone = args.phone;
        if (args.externalId !== undefined) next.externalId = args.externalId;
        if (args.source !== undefined) next.source = args.source;
        if (args.locale !== undefined) next.locale = args.locale;
        return next;
      };
      // Patch the row in place in every cached variant. An edit can change
      // fields that drive search/facet membership (name/email/…), so a filtered
      // view may briefly keep a row it no longer matches (or miss a
      // newly-matching one) — that resolves itself when the mutation settles and
      // Convex re-runs the affected queries. We intentionally don't re-evaluate
      // each variant's predicate client-side: that would mean duplicating the
      // server's filter logic, which the optimistic-update helpers explicitly
      // warn against guessing.
      updateItemInListQuery(
        store,
        api.contacts.queries.listContacts,
        args.contactId,
        applyEdits,
      );
      // Mirror the patch into the paginated view the contacts table renders.
      updateItemInPaginatedQuery(
        store,
        api.contacts.queries.listContactsPaginated,
        args.contactId,
        applyEdits,
      );
    },
  });
}
