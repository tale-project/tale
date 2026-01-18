import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useDeleteThread() {
  return useMutation(api.threads.mutations.deleteChatThread);
}
