import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Message added to nested array - complex optimistic insert
export function useAddMessage() {
  return useMutation(api.conversations.mutations.addMessageToConversation);
}
