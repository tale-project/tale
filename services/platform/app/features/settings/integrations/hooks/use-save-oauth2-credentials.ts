import { useAction } from 'convex/react';

import { api } from '@/convex/_generated/api';

// Note: useAction saves encrypted credentials - can't predict result
export function useSaveOAuth2Credentials() {
  return useAction(api.integrations.actions.saveOAuth2ClientCredentials);
}
