import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

// Note: Saves encrypted credentials - can't predict result
export function useSaveOAuth2Credentials() {
  return useConvexAction(api.integrations.actions.saveOAuth2ClientCredentials);
}
