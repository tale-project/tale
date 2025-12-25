import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Sends email - message added server-side with delivery status
export function useSendMessageViaEmail() {
  return useMutation(api.conversations.sendMessageViaEmail);
}
