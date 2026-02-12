import { useAction } from 'convex/react';

import { api } from '@/convex/_generated/api';

// Note: useAction returns generated URL - can't predict result
export function useGenerateIntegrationOAuth2Url() {
  return useAction(api.integrations.actions.generateOAuth2Url);
}
