import { useAction } from 'convex/react';

import { api } from '@/convex/_generated/api';

// Note: useAction - preloaded query with specific name param makes optimistic complex
export function useUpdateIntegration() {
  return useAction(api.integrations.actions.update);
}
