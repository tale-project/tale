import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

// Used to gate sign-up access: only the first user (owner) can sign up.
// Returns false → show sign-up page; true → redirect to login.
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
