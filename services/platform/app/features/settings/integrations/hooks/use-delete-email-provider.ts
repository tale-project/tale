import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';

export function useDeleteEmailProvider() {
  return useMutation(api.email_providers.mutations.deleteProvider);
}
