import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useDeleteCustomer() {
  return useMutation(api.customers.mutations.deleteCustomer);
}
