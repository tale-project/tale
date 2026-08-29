'use client';

import { useQuery } from '@tanstack/react-query';
import type { FunctionReturnType } from 'convex/server';
import { createContext, useContext } from 'react';

import {
  passwordExpiryQuery,
  twoFactorStatusQuery,
} from '@/app/lib/backend/account';
import type { api } from '@/convex/_generated/api';

// These used to derive from the single `getAccountBootstrap` batch query,
// which was retired with the rest of the bootstrap module; the two underlying
// per-concern queries remain and now define the shapes directly.
export type TwoFactorStatus = FunctionReturnType<
  typeof api.two_factor.queries.getStatus
>;
export type PasswordExpiryStatus = FunctionReturnType<
  typeof api.users.queries.getPasswordExpiryStatus
>;

export interface AccountBootstrapContextValue {
  /** `undefined` until the bootstrap query resolves (treated as "hold"). */
  twoFactor: TwoFactorStatus | undefined;
  /** `undefined` until the bootstrap query resolves. */
  passwordExpiry: PasswordExpiryStatus | undefined;
}

export const AccountBootstrapContext =
  createContext<AccountBootstrapContextValue | null>(null);

/**
 * Raw context accessor — `null` when rendered outside
 * {@link AccountBootstrapProvider}.
 *
 * The provider component lives in `account-bootstrap-provider.tsx`: keeping it
 * out of this file leaves only hooks + the context object here, so the module
 * is not a React Fast Refresh boundary (a file mixing a component with
 * non-component exports breaks HMR — see vite-plugin-react's
 * "consistent-components-exports"). Mirrors `ability-context.tsx` /
 * `use-ability.ts`.
 */
function useAccountBootstrapContext(): AccountBootstrapContextValue | null {
  return useContext(AccountBootstrapContext);
}

/**
 * 2FA status for the current user. Reads the shared bootstrap result when under
 * {@link AccountBootstrapProvider}; otherwise falls back to its own backend
 * fetch (e.g. settings pages reused outside the dashboard). The fallback
 * query is disabled while on-context so there is no double-fetch.
 * Returns `undefined` until the source resolves.
 */
export function useTwoFactorStatus(): TwoFactorStatus | undefined {
  const ctx = useAccountBootstrapContext();
  const fallback = useQuery({
    ...twoFactorStatusQuery(),
    enabled: ctx === null,
  });
  return ctx ? ctx.twoFactor : fallback.data;
}

/**
 * Password-expiry status for the current user. Same on/off-context behavior as
 * {@link useTwoFactorStatus}.
 */
export function usePasswordExpiry(): PasswordExpiryStatus | undefined {
  const ctx = useAccountBootstrapContext();
  const fallback = useQuery({
    ...passwordExpiryQuery(),
    enabled: ctx === null,
  });
  return ctx ? ctx.passwordExpiry : fallback.data;
}
