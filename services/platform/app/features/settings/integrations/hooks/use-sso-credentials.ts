import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useSsoCredentials() {
  return useConvexAction(api.sso_providers.actions.getSsoCredentialsForEmail);
}
