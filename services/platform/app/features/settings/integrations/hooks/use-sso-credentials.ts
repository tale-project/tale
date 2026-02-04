import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useSsoCredentials() {
  return useAction(api.sso_providers.queries.getSsoCredentialsForEmail);
}
