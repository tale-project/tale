import { useConvexActionMutation } from '@/app/hooks/use-convex-action-mutation';
import { api } from '@/convex/_generated/api';

export function useSaveOAuth2Credentials() {
  return useConvexActionMutation(
    api.integrations.actions.saveOAuth2ClientCredentials,
  );
}
