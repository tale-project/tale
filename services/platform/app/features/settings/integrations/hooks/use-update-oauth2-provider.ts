import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpdateOAuth2Provider() {
  return useAction(api.email_providers.actions.updateOAuth2Provider);
}
