import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useUpdateCustomer() {
  return useMutation(api.customers.mutations.updateCustomer);
}
