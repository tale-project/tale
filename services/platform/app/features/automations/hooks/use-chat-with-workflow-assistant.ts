import { useAction } from 'convex/react';

import { api } from '@/convex/_generated/api';

// Note: useAction with streaming response - messages handled via realtime
export function useChatWithWorkflowAssistant() {
  return useAction(api.agents.workflow.actions.chatWithWorkflowAssistant);
}
