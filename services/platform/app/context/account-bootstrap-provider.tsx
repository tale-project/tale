'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';

import {
  AccountBootstrapContext,
  type AccountBootstrapContextValue,
} from '@/app/context/account-bootstrap-context';
import {
  passwordExpiryQuery,
  twoFactorStatusQuery,
} from '@/app/lib/backend/account';
import { markColdLoad } from '@/app/lib/perf/cold-load-trace';

/**
 * Provides the org-independent dashboard gate results (2FA status +
 * password-expiry status). The single `getAccountBootstrap` batch query these
 * came from was retired with the AI-backend bootstrap module, so the provider
 * now runs the two underlying per-concern queries directly — same shared
 * subscription for the whole subtree, one query per concern instead of one
 * total.
 *
 * Mounted once on the `/dashboard` layout so every authenticated child reads
 * these queries instead of each firing its own. Both are served by the 0.5
 * backend on the session cookie (the dashboard `beforeLoad` already proved
 * it), so neither waits for the Convex WebSocket handshake — the 2FA gate
 * lifts as soon as the HTTP reads land.
 *
 * Lives in its own file (component-only export) so it is a clean Fast Refresh
 * boundary; the context object + hooks it pairs with are in
 * `account-bootstrap-context.tsx`.
 */
export function AccountBootstrapProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { data: twoFactor } = useQuery(twoFactorStatusQuery());
  const { data: passwordExpiry } = useQuery(passwordExpiryQuery());

  useEffect(() => {
    if (twoFactor) markColdLoad('account-bootstrap');
  }, [twoFactor]);

  // Stable identity: a fresh object each render would re-fire every consumer's
  // effects (and can thrash a Convex/react-query subscription).
  const value = useMemo<AccountBootstrapContextValue>(
    () => ({
      twoFactor,
      passwordExpiry,
    }),
    [twoFactor, passwordExpiry],
  );

  return (
    <AccountBootstrapContext.Provider value={value}>
      {children}
    </AccountBootstrapContext.Provider>
  );
}
