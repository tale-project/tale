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
  return useBackendMutation('products/mutations:bulkCreateProducts');
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
