import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useGenerateIntegrationOAuth2Url() {
  return useConvexAction(api.integrations.actions.generateOAuth2Url);
}
