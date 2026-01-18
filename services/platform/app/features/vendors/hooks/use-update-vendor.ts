import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpdateVendor() {
  return useMutation(api.vendors.mutations.updateVendor);
}
