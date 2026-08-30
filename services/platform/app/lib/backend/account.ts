import type { QueryClient } from '@tanstack/react-query';
import { queryOptions } from '@tanstack/react-query';

import type {
  PasswordExpiryStatus,
  TwoFactorStatus,
} from '@/app/context/account-bootstrap-context';
import type { ReturnsOf } from '@/app/lib/backend/contract';

import { BackendApiError, backendFetch } from './api-client';
import type {
  ActionQueryAdapter,
  ReadAdapter,
  WriteAdapter,
} from './convex-adapters';
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

/**
 * The changelog viewer's release feed. ORG-FREE like its 0.4 action (the
 * page lives outside the `/dashboard/$id` segment, so there is no org to
 * scope by) — the session cookie is the whole authorization.
 */
export const accountActionQueryAdapters: Record<string, ActionQueryAdapter> = {
  'changelog/actions:listReleases': (args) => () => {
    const from = typeof args.from === 'string' ? args.from : undefined;
    return backendFetch<{ releases: unknown[] }>(
      from === undefined || from === ''
        ? '/changelog/releases'
        : `/changelog/releases?from=${encodeURIComponent(from)}`,
    ).then((body) => body.releases);
  },
};

type NotificationStateResult =
  ReturnsOf<'users/notification_state:getUserNotificationState'>;

/**
 * The changelog dot/toast state — per-USER and org-free, so it keys under
 * the `me` scope like the rest of this module and no `/events` hint lane
 * invalidates it (its two writers invalidate locally).
 */
export const accountReadAdapters: Record<string, ReadAdapter> = {
  'users/notification_state:getUserNotificationState': () => ({
    queryKey: backendKey(ACCOUNT_SCOPE, 'account', 'notification-state'),
    queryFn: () =>
      backendFetch<{ state: NotificationStateResult }>(
        '/users/notification-state',
      ).then((body) => body.state),
  }),
};

function invalidateNotificationState(client: QueryClient): void {
  void client.invalidateQueries({
    queryKey: backendKey(ACCOUNT_SCOPE, 'account', 'notification-state'),
  });
}

/** The version string the changelog writers stamp. */
function versionArg(args: Record<string, unknown>): string {
  return typeof args.version === 'string' ? args.version : '';
}

export const accountWriteAdapters: Record<string, WriteAdapter> = {
  'users/notification_state:markChangelogSeen': {
    run: (args) =>
      backendFetch<{ ok: boolean }>(
        '/users/notification-state/changelog-seen',
        {
          body: { version: versionArg(args) },
        },
      ).then(() => null),
    invalidate: invalidateNotificationState,
  },
  'users/notification_state:markToastShown': {
    run: (args) =>
      backendFetch<{ ok: boolean }>('/users/notification-state/toast-shown', {
        body: { version: versionArg(args) },
      }).then(() => null),
    invalidate: invalidateNotificationState,
  },
};
