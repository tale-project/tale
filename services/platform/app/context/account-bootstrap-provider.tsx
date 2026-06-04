'use client';

import { useEffect, useMemo, type ReactNode } from 'react';

import {
  AccountBootstrapContext,
  type AccountBootstrapContextValue,
} from '@/app/context/account-bootstrap-context';
import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { markColdLoad } from '@/app/lib/perf/cold-load-trace';
import { api } from '@/convex/_generated/api';

/**
 * Provides the org-independent dashboard gate results (2FA status +
 * password-expiry status) from a single `getAccountBootstrap` round-trip.
 *
 * Mounted once on the `/dashboard` layout so every authenticated child reads
 * one query instead of each firing its own. The query is gated on
 * `useConvexAuth().isAuthenticated` so it only runs once the WebSocket is
 * authenticated.
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
  const { isAuthenticated } = useConvexAuth();
  const { data } = useConvexQuery(
    api.bootstrap.queries.getAccountBootstrap,
    {},
    { enabled: isAuthenticated },
  );

  useEffect(() => {
    if (data) markColdLoad('account-bootstrap');
  }, [data]);

  // Stable identity: a fresh object each render would re-fire every consumer's
  // effects (and can thrash a Convex/react-query subscription).
  const value = useMemo<AccountBootstrapContextValue>(
    () => ({
      twoFactor: data?.twoFactor,
      passwordExpiry: data?.passwordExpiry,
    }),
    [data?.twoFactor, data?.passwordExpiry],
  );

  return (
    <AccountBootstrapContext.Provider value={value}>
      {children}
    </AccountBootstrapContext.Provider>
  );
}
