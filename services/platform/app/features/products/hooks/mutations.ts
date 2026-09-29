import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

export function useCreateProduct() {
  return useBackendMutation('products/mutations:createProduct', {
    // The create dialog shows its own specific error toast (duplicate-name vs
    // generic). Without this, the shared hook also fires a generic toast, so a
    // duplicate name surfaces two contradictory toasts.
    errorToast: false,
  });
}

export function useBulkCreateProducts() {
  return useBackendMutation('products/mutations:bulkCreateProducts', {
    // The import dialog toasts a refused file itself, naming its row and
    // column; the default toast would report it a second time.
    errorToast: false,
  });
}

export function useDeleteProduct() {
  return useBackendMutation('products/mutations:deleteProduct', {
    // EntityDeleteDialog shows its own specific error toast.
    errorToast: false,
  });
}

export function useUpdateProduct() {
  return useBackendMutation('products/mutations:updateProduct', {
    // The edit dialog shows its own specific error toast.
    errorToast: false,
  });
}
