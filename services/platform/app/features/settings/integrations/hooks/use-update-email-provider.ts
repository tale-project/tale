import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useUpdateEmailProvider() {
  return useMutation(api.email_providers.mutations.updateProvider);
}
