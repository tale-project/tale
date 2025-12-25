import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Triggers async agent - messages added via streaming
export function useChatWithAgent() {
  return useMutation(api.chat_agent.chatWithAgent);
}
