import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

export function useBulkCreateContacts() {
  return useBackendMutation('contacts/mutations:bulkCreateContacts');
}

export function useCreateContact() {
  return useBackendMutation('contacts/mutations:createContact', {
    // The create dialog shows its own specific error toast (duplicate-email
    // vs generic) — see `useCreateProduct` for the same pattern.
    errorToast: false,
  });
}

export function useDeleteContact() {
  return useBackendMutation('contacts/mutations:deleteContact', {
    // EntityDeleteDialog shows its own specific error toast.
    errorToast: false,
  });
}

export function useUpdateContact() {
  return useBackendMutation('contacts/mutations:updateContact', {
    // The edit dialog shows its own specific error toast.
    errorToast: false,
  });
}
