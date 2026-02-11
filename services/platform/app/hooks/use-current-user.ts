import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useCurrentUser() {
  return useConvexQuery(api.accounts.queries.getCurrentUser);
}
