import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

// hasAnyUsers + isSsoConfigured run on the public login / sign-up pages before
// auth is established, so they opt out of the default auth gate (public probes
// server-side). hasMicrosoftAccount / hasCredentialAccount inspect the CURRENT
// user's linked accounts and are only used in authenticated routes (account
// settings, knowledge), so they keep the default gate — opting them out would
// fire a stale pre-auth result that wouldn't refresh once auth lands.

// Used to gate sign-up access: only the first user (owner) can sign up.
// Returns false → show sign-up page; true → redirect to login.
export function useHasAnyUsers() {
  return useConvexQuery(
    api.users.queries.hasAnyUsers,
    {},
    { requireAuth: false },
  );
}

export function useIsSsoConfigured() {
  return useConvexQuery(
    api.enterprise_sso.queries.isConfigured,
    {},
    { requireAuth: false },
  );
}

// The SSO step's org picker: every enabled connection on a multi-org deployment.
export function useSsoSelectableOrgs() {
  return useConvexQuery(
    api.enterprise_sso.queries.listSelectable,
    {},
    { requireAuth: false },
  );
}

export function useHasMicrosoftAccount() {
  return useConvexQuery(api.accounts.queries.hasMicrosoftAccount, {});
}

export function useHasCredentialAccount() {
  return useConvexQuery(api.accounts.queries.hasCredentialAccount, {});
}
