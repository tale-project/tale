import { useConvexMutation } from '@/app/hooks/use-convex-mutation';

export function useBulkCreateContacts() {
  return useConvexMutation('contacts/mutations:bulkCreateContacts');
}

export function useCreateContact() {
  return useConvexMutation('contacts/mutations:createContact', {
    // The create dialog shows its own specific error toast (duplicate-email
    // vs generic) — see `useCreateProduct` for the same pattern.
    errorToast: false,
  });
}

export function useDeleteContact() {
  return useConvexMutation('contacts/mutations:deleteContact', {
    // EntityDeleteDialog shows its own specific error toast.
    errorToast: false,
  });
}

export function useUpdateContact() {
  return useConvexMutation('contacts/mutations:updateContact', {
    // The edit dialog shows its own specific error toast.
    errorToast: false,
  });
}
