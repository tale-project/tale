import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useDeleteVendor() {
  return useMutation(api.vendors.mutations.deleteVendor);
}
