import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useDeleteEmailProvider() {
  return useMutation(api.email_providers.mutations.deleteProvider);
}
