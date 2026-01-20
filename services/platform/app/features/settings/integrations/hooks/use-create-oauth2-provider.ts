import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: useAction - provider list uses preloaded query, complex optimistic
export function useCreateOAuth2Provider() {
  return useAction(api.email_providers.actions.createOAuth2Provider);
}
