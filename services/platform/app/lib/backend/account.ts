import { queryOptions } from '@tanstack/react-query';

import type {
  PasswordExpiryStatus,
  TwoFactorStatus,
} from '@/app/context/account-bootstrap-context';

import { BackendApiError, backendFetch } from './api-client';
import { backendKey } from './query-keys';

/**
 * Account-scoped reads — the org-INDEPENDENT queries the dashboard gate
 * needs before any org context exists (2FA status, password expiry). The
 * first feature reads served by the 0.5 backend: authenticated by the
 * Better Auth session cookie alone, so they need neither the Convex
 * WebSocket nor its auth handshake.
 *
 * Keys use the literal `me` in the vocabulary's org slot: these rows are
 * per-user, and no `/events` hint lane invalidates them — enrollment and
 * password changes invalidate locally at their action sites.
 */
const ACCOUNT_SCOPE = 'me';

/** Retry transport-shaped failures only: a 4xx from the backend is a
 * deterministic answer (auth gate, validation), and retrying it just
 * delays the UI — the same rationale as the app default's ConvexError
 * carve-out. */
function retryTransportOnly(failureCount: number, error: unknown): boolean {
  return (
    !(error instanceof BackendApiError && error.status < 500) &&
    failureCount < 3
  );
}

/** Fresh-install probe (public): does ANY user exist yet? Drives the
 * sign-in ↔ setup routing on the auth pages. */
export function hasAnyUsersQuery() {
  return queryOptions({
    queryKey: backendKey('me', 'account', 'has-any-users'),
    queryFn: ({ signal }) =>
      backendFetch<{ hasAny: boolean }>('/users/has-any', { signal }).then(
        (body) => body.hasAny,
      ),
    retry: retryTransportOnly,
  });
}

/** The 0.4 `users/queries:getCurrentUser` shape. */
export interface CurrentUserView {
  userId: string;
  email?: string;
  name?: string;
}

export function currentUserQuery() {
  return queryOptions({
    queryKey: backendKey('me', 'account', 'current-user'),
    queryFn: ({ signal }) =>
      backendFetch<{ user: CurrentUserView | null }>('/users/me', {
        signal,
      }).then((body) => body.user),
    retry: retryTransportOnly,
  });
}

/** Which auth account kinds back this user (the 0.4 `accounts/queries`
 * pair, answered in one read). */
export interface AccountFlagsView {
  hasCredentialAccount: boolean;
  hasMicrosoftAccount: boolean;
}

export function accountFlagsQuery() {
  return queryOptions({
    queryKey: backendKey('me', 'account', 'auth-accounts'),
    queryFn: ({ signal }) =>
      backendFetch<AccountFlagsView>('/users/accounts', { signal }),
    retry: retryTransportOnly,
  });
}

/** The 0.4 `two_factor/queries:getStatus` shape off the 0.5 backend. */
export function twoFactorStatusQuery() {
  return queryOptions({
    queryKey: backendKey(ACCOUNT_SCOPE, 'account', 'two-factor-status'),
    queryFn: ({ signal }) =>
      backendFetch<TwoFactorStatus>('/two-factor/status', { signal }),
    retry: retryTransportOnly,
  });
}

/** The 0.4 `users/queries:getPasswordExpiryStatus` shape off the 0.5
 * backend. */
export function passwordExpiryQuery() {
  return queryOptions({
    queryKey: backendKey(ACCOUNT_SCOPE, 'account', 'password-expiry'),
    queryFn: ({ signal }) =>
      backendFetch<PasswordExpiryStatus>('/users/password-expiry', { signal }),
    retry: retryTransportOnly,
  });
}
