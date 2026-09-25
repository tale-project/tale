/**
 * The one piece of state the panel has: what the account list currently says.
 *
 * The list re-reads on a timer because the figures it shows move without
 * anyone clicking: the background loop refreshes tokens and usage readings on
 * its own cadence, so a panel left open should not go stale.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { gatewayApi, type AccountView, type ProviderId } from './api';

/** How often an open panel re-reads the account list. */
const ACCOUNTS_POLL_MS = 60_000;

export interface AccountsState {
  /**
   * The list as last read, or `null` until a read has succeeded. A later
   * read that fails leaves it as it was — it is still the best list there
   * is, and `error` says it may be behind.
   */
  accounts: AccountView[] | null;
  /** Why the latest read failed; `null` once one succeeds again. */
  error: Error | null;
  reload: () => void;
}

export function useAccounts(): AccountsState {
  const [accounts, setAccounts] = useState<AccountView[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // `reload` reaches the live reader through this, so re-reading on demand
  // does not need a dependency that re-runs the whole effect.
  const readNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    let cancelled = false;
    // A panel left open while the gateway is out of reach fails a read every
    // minute; the console hears about the first of a run, not each one.
    let failing = false;

    const read = async () => {
      try {
        const next = await gatewayApi.accounts();
        if (cancelled) return;
        failing = false;
        setAccounts(next);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        if (!failing) {
          console.warn('[ai-gateway] reading the account list failed:', cause);
        }
        failing = true;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      }
    };

    readNow.current = () => void read();
    void read();
    const timer = setInterval(() => void read(), ACCOUNTS_POLL_MS);
    return () => {
      cancelled = true;
      readNow.current = () => undefined;
      clearInterval(timer);
    };
  }, []);

  const reload = useCallback(() => readNow.current(), []);

  return { accounts, error, reload };
}

/**
 * The providers this gateway can add an account for.
 *
 * Read from the server rather than listed here, so a provider added to the
 * registry appears in the picker without a second edit on this side. Only its
 * `providers.<id>` label is the panel's to supply.
 */
export function useProviders(): ProviderId[] {
  const [providers, setProviders] = useState<ProviderId[]>([]);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const catalog = await gatewayApi.providers();
        if (!cancelled) setProviders(catalog.map((entry) => entry.id));
      } catch (cause) {
        // The picker then stays empty and its Continue disabled, which is
        // honest: nothing can be added until the gateway answers.
        console.warn(
          '[ai-gateway] the provider catalog could not be read:',
          cause,
        );
      }
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, []);

  return providers;
}
