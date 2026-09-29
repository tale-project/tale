import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

export function useBulkCreateContacts() {
  return useBackendMutation('contacts/mutations:bulkCreateContacts', {
    // The import dialog toasts a refused file itself, naming its row and
    // column; the default toast would report it a second time.
    errorToast: false,
  });
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
