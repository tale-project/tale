import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: useAction returns generated URL - can't predict result
export function useGenerateOAuthUrl() {
  return useAction(api.email_providers.actions.generateOAuth2AuthUrl);
}
