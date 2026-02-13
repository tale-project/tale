import { useConvexActionMutation } from '@/app/hooks/use-convex-action-mutation';
import { api } from '@/convex/_generated/api';

export function useGenerateIntegrationOAuth2Url() {
  return useConvexActionMutation(api.integrations.actions.generateOAuth2Url);
}
