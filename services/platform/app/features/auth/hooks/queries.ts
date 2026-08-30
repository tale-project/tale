import { useQuery } from '@tanstack/react-query';

import { accountFlagsQuery, hasAnyUsersQuery } from '@/app/lib/backend/account';
import { ssoConfiguredQuery, ssoSelectableQuery } from '@/app/lib/backend/org';

// hasAnyUsers + the SSO discovery pair run on the public login / sign-up
// pages before auth is established — the backend serves them without a
// session (public probes server-side). The account-flags read inspects the
// CURRENT user's linked accounts and only renders in authenticated routes;
// on a signed-out call it answers 401 (no retry) and `data` stays
// undefined, which those surfaces already treat as "hold".

// Used to gate sign-up access: only the first user (owner) can sign up.
// Returns false → show sign-up page; true → redirect to login.
export function useHasAnyUsers() {
  return useQuery(hasAnyUsersQuery());
}

export function useIsSsoConfigured() {
  return useQuery(ssoConfiguredQuery());
}

// The SSO step's org picker: every enabled connection on a multi-org deployment.
export function useSsoSelectableOrgs() {
  return useQuery(ssoSelectableQuery());
}

export function useHasMicrosoftAccount() {
  return useQuery({
    ...accountFlagsQuery(),
    select: (flags) => flags.hasMicrosoftAccount,
  });
}

export function useHasCredentialAccount() {
  return useQuery({
    ...accountFlagsQuery(),
    select: (flags) => flags.hasCredentialAccount,
  });
}
