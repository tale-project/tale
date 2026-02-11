import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useHasAnyUsers() {
  return useConvexQuery(api.users.queries.hasAnyUsers, {});
}

export function useIsSsoConfigured() {
  return useConvexQuery(api.sso_providers.queries.isSsoConfigured, {});
}

export function useHasMicrosoftAccount() {
  return useConvexQuery(api.accounts.queries.hasMicrosoftAccount, {});
}

export function useHasCredentialAccount() {
  return useConvexQuery(api.accounts.queries.hasCredentialAccount, {});
}
