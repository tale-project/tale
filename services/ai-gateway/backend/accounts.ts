/**
 * The account lifecycle, one level above the providers.
 *
 * Everything here is provider-agnostic: it starts an authorization, completes
 * one, keeps an access token ahead of its expiry, caches a usage reading, and
 * hands the pool out. Which vendor a row belongs to only decides which module
 * in the registry answers the call.
 */

import { randomUUID } from 'node:crypto';

import { CipherError, type TokenCipher } from './crypto';
import type { ProviderRegistry } from './providers/index';
import { generateState } from './providers/oauth';
import {
  ProviderError,
  type ProviderExchange,
  type ProviderIdentity,
} from './providers/types';
import type { ProviderId } from './providers/types';
import {
  toAccountView,
  type AccountStore,
  type AccountView,
  type PendingAuthorization,
  type StoredAccount,
} from './store';

/** How long an unfinished authorization stays completable. */
const PENDING_AUTHORIZATION_TTL_MS = 30 * 60 * 1000;

/**
 * How long what a vendor said about an account — its address, its plan —
 * stands before the vendor is asked again. A plan changes when someone
 * upgrades, which should show the same day, not never.
 */
const IDENTITY_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * How long a refresh that failed for a passing reason — a rate limit, an
 * outage — waits before the next try. Every hand-out wants a fresh token, and
 * without a pause each one would ask a vendor that is already limiting again.
 */
const REFRESH_RETRY_PAUSE_MS = 60 * 1000;

export class AccountError extends Error {
  constructor(
    readonly code:
      | 'unknown_account'
      | 'unknown_state'
      | 'missing_code'
      | 'state_mismatch'
      | 'exchange_failed',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AccountError';
  }
}

/** One account's credentials, as the token endpoints hand them out. */
export interface TokenHandout {
  id: string;
  provider: ProviderId;
  label: string;
  accountEmail: string | null;
  status: StoredAccount['status'];
  accessToken: string;
  expiresAt: string | null;
  scopes: string | null;
}

export interface AccountServiceOptions {
  store: AccountStore;
  providers: ProviderRegistry;
  cipher: TokenCipher;
  /** Refresh an access token this many seconds before it actually expires. */
  tokenRefreshSkewSeconds: number;
  /** Floor between two usage reads for one account. */
  usageMinIntervalSeconds: number;
  /** Injectable clock, so the expiry and throttle rules are testable. */
  now?: () => Date;
}

export interface AccountService {
  list(): Promise<AccountView[]>;
  beginAuthorization(input: {
    provider: ProviderId;
    accountId?: string | null;
  }): Promise<{
    state: string;
    authorizeUrl: string;
    callbackStyle: 'code' | 'redirect-url';
  }>;
  completeAuthorization(input: {
    state: string;
    pasted: string;
    label?: string | null;
  }): Promise<AccountView>;
  remove(id: string): Promise<boolean>;
  cliCommand(id: string): Promise<string | null>;
  /** One background pass: refresh every account's token and usage reading. */
  refreshAll(): Promise<void>;
  /**
   * Access tokens, each refreshed first if it is close to expiry. Naming a
   * provider narrows the pool to that vendor's accounts — and refreshes only
   * those, so `/api/tokens/anthropic` never spends OpenAI's rate budget.
   */
  handOutTokens(provider?: ProviderId): Promise<TokenHandout[]>;
}

export function createAccountService(
  options: AccountServiceOptions,
): AccountService {
  const { store, providers, cipher } = options;
  const now = options.now ?? (() => new Date());

  function providerFor(account: StoredAccount) {
    return providers[account.provider];
  }

  /** Merge what a vendor said about the account onto the stored row. */
  function applyIdentity(
    account: StoredAccount,
    identity: ProviderIdentity | null,
  ): void {
    if (!identity) return;
    if (identity.email) account.accountEmail = identity.email;
    if (identity.accountId) account.accountId = identity.accountId;
    if (identity.subscription) account.subscription = identity.subscription;
  }

  function defaultLabel(
    provider: ProviderId,
    identity: ProviderIdentity | null,
  ): string {
    return identity?.email ?? identity?.accountId ?? provider;
  }

  /** Refreshes in flight, by account: one grant is never spent twice at once. */
  const refreshing = new Map<string, Promise<StoredAccount>>();
  /** When each account's last refresh failed for a reason that passes. */
  const refreshFailedAt = new Map<string, number>();

  /** Whether an access token is inside the skew window before expiry, or past it. */
  function needsRefresh(account: StoredAccount): boolean {
    if (account.status === 'expired') return false;
    const failedAt = refreshFailedAt.get(account.id);
    if (
      failedAt !== undefined &&
      now().getTime() - failedAt < REFRESH_RETRY_PAUSE_MS
    ) {
      return false;
    }
    if (!account.expiresAt) return true;
    const expiresAt = new Date(account.expiresAt).getTime();
    const skewMs = options.tokenRefreshSkewSeconds * 1000;
    return !(
      Number.isFinite(expiresAt) && expiresAt - skewMs > now().getTime()
    );
  }

  /**
   * Refresh the access token when it is inside the skew window, or gone.
   *
   * Both vendors ROTATE the refresh token: every refresh answers a new one
   * and retires the old. So a refresh never runs twice for one account at
   * once — the panel's poll, the background pass and a token hand-out can all
   * arrive together near an expiry, and they share the one in flight — and it
   * starts from the row as stored, never from a copy read before another
   * caller refreshed it. Either mistake spends a retired token, which the
   * vendor refuses.
   *
   * A refusal (`refresh_rejected`) is terminal: the account is `expired` and
   * waits for someone to re-authenticate it. Anything else — a rate limit, an
   * outage — is `error`, the same token is tried again after a short pause,
   * and a refresh storm against a vendor that is already limiting is avoided.
   */
  function ensureFresh(account: StoredAccount): Promise<StoredAccount> {
    if (!needsRefresh(account)) return Promise.resolve(account);
    const inFlight = refreshing.get(account.id);
    if (inFlight) return inFlight;
    const run = refreshStored(account).finally(() => {
      refreshing.delete(account.id);
    });
    refreshing.set(account.id, run);
    return run;
  }

  async function refreshStored(held: StoredAccount): Promise<StoredAccount> {
    const account = await store.getAccount(held.id);
    // Removed while the caller held its copy: nothing to refresh, or to keep.
    if (!account) return held;
    if (!needsRefresh(account)) return account;

    try {
      const exchange = await providerFor(account).refresh(
        cipher.open(account.refreshToken),
      );
      refreshFailedAt.delete(account.id);
      const updated = await store.updateAccount(account.id, (row) => {
        row.accessToken = cipher.seal(exchange.tokens.accessToken);
        if (exchange.tokens.refreshToken) {
          row.refreshToken = cipher.seal(exchange.tokens.refreshToken);
        }
        row.expiresAt = exchange.tokens.expiresAt;
        row.scopes = exchange.tokens.scopes;
        row.status = 'active';
        row.lastRefreshedAt = now().toISOString();
        applyIdentity(row, exchange.identity);
      });
      return updated ?? account;
    } catch (error) {
      // Terminal: the vendor refused the grant, or the stored refresh token
      // no longer opens (a replaced encryption key) — either way only a new
      // sign-in brings the account back, and retrying would change nothing.
      const refused =
        (error instanceof ProviderError && error.code === 'refresh_rejected') ||
        error instanceof CipherError;
      if (!refused) refreshFailedAt.set(account.id, now().getTime());
      console.warn(
        `[ai-gateway] refresh ${refused ? 'refused' : 'failed'} for ${account.provider} account ${account.id}:`,
        error instanceof Error ? error.message : error,
      );
      const updated = await store.updateAccount(account.id, (row) => {
        row.status = refused ? 'expired' : 'error';
      });
      return updated ?? account;
    }
  }

  /**
   * Ask the vendor who the credential belongs to and what it subscribes to,
   * when that takes a call of its own — until both are known, and again once
   * the answer has aged past `IDENTITY_MAX_AGE_MS`.
   */
  async function ensureIdentity(
    account: StoredAccount,
  ): Promise<StoredAccount> {
    const provider = providerFor(account);
    if (!provider.fetchIdentity) return account;
    const checkedAt = account.identityCheckedAt
      ? new Date(account.identityCheckedAt).getTime()
      : Number.NaN;
    const known =
      account.accountEmail !== null && account.subscription !== null;
    if (
      known &&
      Number.isFinite(checkedAt) &&
      now().getTime() - checkedAt < IDENTITY_MAX_AGE_MS
    ) {
      return account;
    }
    let identity: ProviderIdentity;
    try {
      identity = await provider.fetchIdentity({
        accessToken: cipher.open(account.accessToken),
        accountId: account.accountId,
      });
    } catch (error) {
      // Not fatal: the row keeps its label and the next pass tries again.
      console.warn(
        `[ai-gateway] identity lookup failed for ${account.provider} account ${account.id}:`,
        error instanceof Error ? error.message : error,
      );
      return account;
    }
    const updated = await store.updateAccount(account.id, (row) => {
      applyIdentity(row, identity);
      row.identityCheckedAt = now().toISOString();
      if (row.label === row.provider && row.accountEmail) {
        row.label = row.accountEmail;
      }
    });
    return updated ?? account;
  }

  /**
   * Read the account's usage windows, no more often than the floor allows.
   *
   * Both vendors rate-limit this endpoint per token hard enough that an
   * unthrottled panel poll would spend the budget, so nothing is asked until
   * the last ATTEMPT has aged past `usageMinIntervalSeconds` — the attempt,
   * not the reading, so a vendor that keeps failing is not asked every pass.
   *
   * A failed read keeps the last reading AND the time it was read. Stamping
   * the old figures with the new time is what used to let a reading from days
   * ago pass for current: weekly figures only climb during a week, so a
   * frozen one reads as simply wrong.
   */
  async function refreshUsage(
    account: StoredAccount,
    { force = false } = {},
  ): Promise<StoredAccount> {
    let current = await ensureFresh(account);
    if (current.status === 'expired') return current;

    if (!force) {
      const last = current.usageAttemptedAt ?? current.usage?.checkedAt;
      const lastMs = last ? new Date(last).getTime() : Number.NaN;
      if (
        Number.isFinite(lastMs) &&
        (now().getTime() - lastMs) / 1000 < options.usageMinIntervalSeconds
      ) {
        return current;
      }
    }

    // Inside the floor rather than ahead of it: a profile endpoint that keeps
    // failing is then retried once per usage read, not on every panel poll.
    current = await ensureIdentity(current);

    try {
      const reading = await providerFor(current).fetchUsage({
        accessToken: cipher.open(current.accessToken),
        accountId: current.accountId,
      });
      const updated = await store.updateAccount(current.id, (row) => {
        const at = now().toISOString();
        row.usage = { windows: reading.windows, checkedAt: at };
        row.usageAttemptedAt = at;
        // The freshest word on the plan, where the usage answer carries one.
        if (reading.subscription) row.subscription = reading.subscription;
        // A reading proves the access token works. It does not revive a
        // refresh token the vendor refused: that account stays `expired`
        // until someone signs it in again.
        if (row.status !== 'expired') row.status = 'active';
      });
      return updated ?? current;
    } catch (error) {
      // A usage failure says the credential does not work for inference right
      // now, not that the refresh token is spent — hence `error`, not
      // `expired`: the account stays in the pool and keeps being retried.
      console.warn(
        `[ai-gateway] usage read failed for ${current.provider} account ${current.id}:`,
        error instanceof Error ? error.message : error,
      );
      const updated = await store.updateAccount(current.id, (row) => {
        row.usageAttemptedAt = now().toISOString();
        if (row.status !== 'expired') row.status = 'error';
      });
      return updated ?? current;
    }
  }

  /**
   * Land a completed grant on its account — the one it re-authenticates, or
   * a new row — and answer it with a first usage reading on it, so the
   * panel's bars are populated on arrival rather than a pass later.
   */
  async function storeGrant(
    pending: PendingAuthorization,
    exchange: ProviderExchange,
    label: string | null,
  ): Promise<StoredAccount> {
    const timestamp = now().toISOString();
    const named = label?.trim() || null;
    const grant = (row: StoredAccount) => {
      row.accessToken = cipher.seal(exchange.tokens.accessToken);
      row.refreshToken = cipher.seal(exchange.tokens.refreshToken);
      row.expiresAt = exchange.tokens.expiresAt;
      row.scopes = exchange.tokens.scopes;
      row.status = 'active';
      row.lastRefreshedAt = timestamp;
      applyIdentity(row, exchange.identity);
      if (named) row.label = named;
    };

    const reauthenticated = pending.targetAccountId
      ? await store.updateAccount(pending.targetAccountId, grant)
      : null;
    if (reauthenticated) {
      // A new grant: whatever paused the old one's refreshes is over.
      refreshFailedAt.delete(reauthenticated.id);
      return refreshUsage(reauthenticated, { force: true });
    }

    const account: StoredAccount = {
      id: randomUUID(),
      provider: pending.provider,
      label: defaultLabel(pending.provider, exchange.identity),
      accountEmail: null,
      accountId: null,
      subscription: null,
      identityCheckedAt: null,
      accessToken: '',
      refreshToken: '',
      expiresAt: null,
      scopes: null,
      status: 'active',
      createdAt: timestamp,
      lastRefreshedAt: null,
      usage: null,
      usageAttemptedAt: null,
    };
    grant(account);
    await store.putAccount(account);
    return refreshUsage(account, { force: true });
  }

  return {
    async list() {
      const accounts = await store.listAccounts();
      const refreshed = [];
      for (const account of accounts) {
        refreshed.push(await refreshUsage(account));
      }
      return refreshed.map(toAccountView);
    },

    async beginAuthorization({ provider: providerId, accountId = null }) {
      if (accountId && !(await store.getAccount(accountId))) {
        throw new AccountError(
          'unknown_account',
          'That account no longer exists.',
        );
      }
      const provider = providers[providerId];
      const state = generateState();
      const request = provider.beginAuthorization(state);
      await store.prunePending(PENDING_AUTHORIZATION_TTL_MS, now());
      await store.addPending({
        state,
        provider: providerId,
        codeVerifier: request.codeVerifier,
        redirectUri: request.redirectUri,
        targetAccountId: accountId,
        createdAt: now().toISOString(),
      });
      return {
        state,
        authorizeUrl: request.authorizeUrl,
        callbackStyle: provider.callbackStyle,
      };
    },

    async completeAuthorization({ state, pasted, label = null }) {
      const pending = await store.takePending(state);
      if (!pending) {
        throw new AccountError(
          'unknown_state',
          'That authorization has expired or was already completed.',
        );
      }

      const provider = providers[pending.provider];
      const parsed = provider.parseCallback(pasted);
      if (!parsed.code) {
        throw new AccountError(
          'missing_code',
          'No authorization code was found in what was pasted back.',
        );
      }
      if (parsed.state && parsed.state !== pending.state) {
        throw new AccountError(
          'state_mismatch',
          'The pasted value belongs to a different authorization.',
        );
      }

      let exchange;
      try {
        exchange = await provider.exchangeCode({
          code: parsed.code,
          codeVerifier: pending.codeVerifier,
          redirectUri: pending.redirectUri,
          state: pending.state,
        });
      } catch (error) {
        throw new AccountError(
          'exchange_failed',
          error instanceof ProviderError
            ? error.message
            : 'The authorization code could not be exchanged.',
          { cause: error },
        );
      }

      return toAccountView(await storeGrant(pending, exchange, label));
    },

    remove(id) {
      return store.deleteAccount(id);
    },

    async cliCommand(id) {
      const account = await store.getAccount(id);
      if (!account) return null;
      const fresh = await ensureFresh(account);
      return providerFor(fresh).cliCommand(cipher.open(fresh.accessToken));
    },

    async refreshAll() {
      await store.prunePending(PENDING_AUTHORIZATION_TTL_MS, now());
      for (const account of await store.listAccounts()) {
        await refreshUsage(account);
      }
    },

    async handOutTokens(provider) {
      const handouts: TokenHandout[] = [];
      for (const account of await store.listAccounts()) {
        if (provider !== undefined && account.provider !== provider) continue;
        const fresh = await ensureFresh(account);
        handouts.push({
          id: fresh.id,
          provider: fresh.provider,
          label: fresh.label,
          accountEmail: fresh.accountEmail,
          status: fresh.status,
          accessToken: cipher.open(fresh.accessToken),
          expiresAt: fresh.expiresAt,
          scopes: fresh.scopes,
        });
      }
      return handouts;
    },
  };
}
