import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useSendMessageViaIntegration() {
  return useMutation(api.conversations.mutations.sendMessageViaIntegration);
}
