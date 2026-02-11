import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useSsoProvider() {
  return useConvexQuery(api.sso_providers.queries.get, {});
}

export function useSsoFullConfig() {
  return useConvexAction(api.sso_providers.actions.getWithClientId);
}
