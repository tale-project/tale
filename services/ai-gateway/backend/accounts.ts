/**
 * The account lifecycle, one level above the providers.
 *
 * Everything here is provider-agnostic: it starts an authorization, completes
 * one, keeps an access token ahead of its expiry, caches a usage reading, and
 * hands the pool out. Which vendor a row belongs to only decides which module
 * in the registry answers the call.
 */

import { randomUUID } from 'node:crypto';

import type { TokenCipher } from './crypto';
import type { ProviderRegistry } from './providers/index';
import { generateState } from './providers/oauth';
import { ProviderError, type ProviderIdentity } from './providers/types';
import type { ProviderId } from './providers/types';
import {
  toAccountView,
  type AccountStore,
  type AccountView,
  type StoredAccount,
} from './store';

/** How long an unfinished authorization stays completable. */
const PENDING_AUTHORIZATION_TTL_MS = 30 * 60 * 1000;

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

/** One account's credentials, as the token endpoint hands them out. */
export interface TokenHandout {
  id: string;
  provider: ProviderId;
  label: string;
  accountEmail: string | null;
  /** The vendor's own account handle, where its API needs one. */
  accountId: string | null;
  status: StoredAccount['status'];
  accessToken: string;
  expiresAt: string | null;
  scopes: string | null;
  /** The variable that hands this token to the provider's own CLI. */
  envVar: string;
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
  /** Every account's access token, each refreshed first if it is close to expiry. */
  handOutTokens(): Promise<TokenHandout[]>;
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
    if (identity.plan) account.plan = identity.plan;
  }

  function defaultLabel(
    provider: ProviderId,
    identity: ProviderIdentity | null,
  ): string {
    return identity?.email ?? identity?.accountId ?? provider;
  }

  /**
   * Refresh the access token when it is inside the skew window, or gone.
   *
   * A failed refresh is terminal for the credential rather than transient:
   * the refresh token is what a long-lived account rests on, so the account
   * is marked `expired` and drops out of the pool until someone
   * re-authenticates it.
   */
  async function ensureFresh(
    account: StoredAccount,
    { force = false } = {},
  ): Promise<StoredAccount> {
    if (account.status === 'expired') return account;
    if (!force && account.expiresAt) {
      const expiresAt = new Date(account.expiresAt).getTime();
      const skewMs = options.tokenRefreshSkewSeconds * 1000;
      if (Number.isFinite(expiresAt) && expiresAt - skewMs > now().getTime()) {
        return account;
      }
    }

    try {
      const exchange = await providerFor(account).refresh(
        cipher.open(account.refreshToken),
      );
      account.accessToken = cipher.seal(exchange.tokens.accessToken);
      if (exchange.tokens.refreshToken) {
        account.refreshToken = cipher.seal(exchange.tokens.refreshToken);
      }
      account.expiresAt = exchange.tokens.expiresAt;
      account.scopes = exchange.tokens.scopes;
      account.status = 'active';
      account.lastRefreshedAt = now().toISOString();
      applyIdentity(account, exchange.identity);
    } catch (error) {
      console.warn(
        `[ai-gateway] refresh failed for ${account.provider} account ${account.id}:`,
        error instanceof Error ? error.message : error,
      );
      account.status = 'expired';
    }
    await store.putAccount(account);
    return account;
  }

  /** Ask the vendor who the credential belongs to, when it takes a call. */
  async function ensureIdentity(
    account: StoredAccount,
  ): Promise<StoredAccount> {
    const provider = providerFor(account);
    if (account.accountEmail || !provider.fetchIdentity) return account;
    try {
      applyIdentity(
        account,
        await provider.fetchIdentity({
          accessToken: cipher.open(account.accessToken),
          accountId: account.accountId,
        }),
      );
    } catch (error) {
      // Not fatal: the row keeps its label and the next pass tries again.
      console.warn(
        `[ai-gateway] identity lookup failed for ${account.provider} account ${account.id}:`,
        error instanceof Error ? error.message : error,
      );
      return account;
    }
    if (account.label === account.provider && account.accountEmail) {
      account.label = account.accountEmail;
    }
    await store.putAccount(account);
    return account;
  }

  /**
   * Read the account's usage windows, no more often than the floor allows.
   *
   * Both vendors rate-limit this endpoint per token hard enough that an
   * unthrottled panel poll would spend the budget, so a cached reading is
   * served until it ages past `usageMinIntervalSeconds`.
   */
  async function refreshUsage(
    account: StoredAccount,
    { force = false } = {},
  ): Promise<StoredAccount> {
    let current = await ensureFresh(account);
    if (current.status === 'expired') return current;
    current = await ensureIdentity(current);

    if (!force && current.usage) {
      const checked = new Date(current.usage.checkedAt).getTime();
      const ageSeconds = (now().getTime() - checked) / 1000;
      if (
        Number.isFinite(checked) &&
        ageSeconds < options.usageMinIntervalSeconds
      ) {
        return current;
      }
    }

    try {
      const windows = await providerFor(current).fetchUsage({
        accessToken: cipher.open(current.accessToken),
        accountId: current.accountId,
      });
      current.usage = { windows, checkedAt: now().toISOString() };
      current.status = 'active';
    } catch (error) {
      // A usage failure says the credential no longer works for inference,
      // but not that the refresh token is spent — hence `error`, not
      // `expired`: the account stays in the pool and keeps being retried.
      console.warn(
        `[ai-gateway] usage read failed for ${current.provider} account ${current.id}:`,
        error instanceof Error ? error.message : error,
      );
      current.status = 'error';
      current.usage = current.usage
        ? { ...current.usage, checkedAt: now().toISOString() }
        : { windows: [], checkedAt: now().toISOString() };
    }
    await store.putAccount(current);
    return current;
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

      const existing = pending.targetAccountId
        ? await store.getAccount(pending.targetAccountId)
        : null;
      const timestamp = now().toISOString();
      const account: StoredAccount = existing ?? {
        id: randomUUID(),
        provider: pending.provider,
        label:
          label?.trim() || defaultLabel(pending.provider, exchange.identity),
        accountEmail: null,
        accountId: null,
        plan: null,
        accessToken: '',
        refreshToken: '',
        expiresAt: null,
        scopes: null,
        status: 'active',
        createdAt: timestamp,
        lastRefreshedAt: null,
        usage: null,
      };
      if (existing && label?.trim()) account.label = label.trim();

      account.accessToken = cipher.seal(exchange.tokens.accessToken);
      account.refreshToken = cipher.seal(exchange.tokens.refreshToken);
      account.expiresAt = exchange.tokens.expiresAt;
      account.scopes = exchange.tokens.scopes;
      account.status = 'active';
      account.lastRefreshedAt = timestamp;
      applyIdentity(account, exchange.identity);
      await store.putAccount(account);

      // Pull a first reading so the panel's bars are populated on arrival.
      return toAccountView(await refreshUsage(account, { force: true }));
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

    async handOutTokens() {
      const handouts: TokenHandout[] = [];
      for (const account of await store.listAccounts()) {
        const fresh = await ensureFresh(account);
        handouts.push({
          id: fresh.id,
          provider: fresh.provider,
          label: fresh.label,
          accountEmail: fresh.accountEmail,
          accountId: fresh.accountId,
          status: fresh.status,
          accessToken: cipher.open(fresh.accessToken),
          expiresAt: fresh.expiresAt,
          scopes: fresh.scopes,
          envVar: providerFor(fresh).cliTokenEnvVar,
        });
      }
      return handouts;
    },
  };
}
