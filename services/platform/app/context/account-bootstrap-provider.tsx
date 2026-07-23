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
 * password-expiry status). The single `getAccountBootstrap` batch query these
 * came from was retired with the AI-backend bootstrap module, so the provider
 * now runs the two underlying per-concern queries directly — same shared
 * subscription for the whole subtree, one query per concern instead of one
 * total.
 *
 * Mounted once on the `/dashboard` layout so every authenticated child reads
 * these queries instead of each firing its own. Both are gated on
 * `useConvexAuth().isAuthenticated` so they only run once the WebSocket is
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
  const { data: twoFactor } = useConvexQuery(
    api.two_factor.queries.getStatus,
    {},
    { enabled: isAuthenticated },
  );
  const { data: passwordExpiry } = useConvexQuery(
    api.users.queries.getPasswordExpiryStatus,
    {},
    { enabled: isAuthenticated },
  );

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
