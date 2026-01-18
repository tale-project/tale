import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpdateThread() {
  return useMutation(api.threads.mutations.updateChatThread);
}
