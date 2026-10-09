/**
 * The account lifecycle, one level above the providers.
 *
 * Everything here is provider-agnostic: it starts an authorization, completes
 * one, keeps each access token ahead of its expiry on a schedule of its own,
 * caches a usage reading, and hands the pool out. Which vendor a row belongs
 * to only decides which module in the registry answers the call.
 */

import { createHash, randomUUID } from 'node:crypto';

import { CipherError, type TokenCipher } from './crypto';
import type { ProviderRegistry } from './providers/index';
import { generateState } from './providers/oauth';
import {
  ProviderError,
  type AuthorizationRequest,
  type CallbackStyle,
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

/** A failed metrics endpoint must not strand an account on an old quota. */
const USAGE_AVAILABILITY_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * How far ahead of the skew an account's refresh may be planned, as a share
 * of the window between the token's issue and the skew point.
 *
 * A refresh ends the token it replaces — Anthropic revokes the old access
 * token — so every turn still running on it fails. With one threshold for
 * the whole pool, accounts refreshed together (the first pass after an
 * outage) are revoked together, and stay together: each refresh restarts the
 * same lifetime. Each account instead plans its refresh earlier by its own
 * share of this spread, so accounts refreshed together fall due at different
 * moments and, each on a cycle of its own length, do not stay in step: they
 * meet again only by chance, and `REFRESH_SPACING_MS` keeps those apart.
 */
const REFRESH_SPREAD_SHARE = 0.5;

/**
 * The least time between two refreshes of one vendor's accounts. The spread
 * keeps accounts out of step, but accounts on cycles of different lengths
 * still fall due together now and then — and the first pass after an outage
 * or an upgrade finds many due at once. Spacing their refreshes keeps one
 * moment from ending the running work of two accounts. A due account waits
 * for its turn only until its skew point: past it, its own token is about to
 * expire and the refresh cannot wait.
 */
const REFRESH_SPACING_MS = 10 * 60 * 1000;

/**
 * Where in the refresh spread an account falls: a fraction in [0, 1) read
 * off a hash of its id, so it stays the same across passes and restarts.
 */
export function refreshStaggerShare(accountId: string): number {
  return (
    createHash('sha256').update(accountId).digest().readUInt32BE(0) / 2 ** 32
  );
}

/**
 * Why an authorization could not go on. The codes are the panel's to
 * translate; `expired` and `denied` end a flow that finished without it (a
 * device code nobody approved in time, a consent somebody declined).
 */
export type AuthorizationFailure =
  | 'unknown_state'
  | 'missing_code'
  | 'state_mismatch'
  | 'exchange_failed'
  | 'expired'
  | 'denied'
  | 'unavailable';

const AUTHORIZATION_FAILURES: readonly AuthorizationFailure[] = [
  'unknown_state',
  'missing_code',
  'state_mismatch',
  'exchange_failed',
  'expired',
  'denied',
  'unavailable',
];

/** A stored failure, read back as a code the panel knows. */
function asFailure(value: string | null): AuthorizationFailure {
  return (
    AUTHORIZATION_FAILURES.find((code) => code === value) ?? 'exchange_failed'
  );
}

/**
 * This gateway's own `/callback` as a vendor may be told to redirect to —
 * only when the browser reaches the gateway on a loopback origin, the one kind
 * of address Claude Code's client lets a redirect go to. Always spelled
 * `localhost`, the host Claude Code itself registers the redirect under, on
 * whatever port the origin has: RFC 8252 lets a loopback redirect choose it.
 * Anything else — a public host, a path, credentials in the URL — is no
 * loopback origin, and the vendor's own page is used instead.
 */
export function loopbackRedirectUri(origin: string | null): string | null {
  if (!origin || !URL.canParse(origin)) return null;
  const url = new URL(origin);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'http:' || !loopback) return null;
  if (url.pathname !== '/' || url.search || url.hash || url.username) {
    return null;
  }
  return `http://localhost${url.port ? `:${url.port}` : ''}/callback`;
}

export class AccountError extends Error {
  constructor(
    readonly code: 'unknown_account' | AuthorizationFailure,
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
  /** Vendor identity, distinct from the gateway's stable pool entry `id`. */
  accountId: string | null;
  status: StoredAccount['status'];
  accessToken: string;
  /** The vendor's own expiry of the access token. */
  expiresAt: string | null;
  /**
   * When the gateway plans to refresh the access token, which ends it for
   * whoever holds it: the end of its usable life. Null when the vendor
   * stated no expiry.
   */
  refreshAt: string | null;
  scopes: string | null;
  usage: StoredAccount['usage'];
  /**
   * Whether the account may be handed to new work: false while a fresh
   * reading shows its quota spent, or while its token is closer to its
   * planned refresh than the hand-out floor and another account of the
   * vendor can take the work instead. Status is a separate check.
   */
  available: boolean;
  /**
   * When every block lifts — the latest of an exhausted window's reset and
   * the planned refresh — or null when one of them has no known time.
   */
  availableAt: string | null;
  /**
   * Why an unavailable account is held back, null while it is available:
   * `quota` while its quota is spent, `refresh` while only the hand-out
   * floor holds it. The floor judges "another account can take the work"
   * by this gateway's view of the pool, which knows nothing of a consumer's
   * own rules — a cooldown after a rate limit, a vendor account id it
   * requires. A consumer those rules leave with no available account may
   * still start work on a `refresh` hold, the latest `refreshAt` first, as
   * this gateway would itself for a pool with nothing else
   * (`releaseLastServable`); never on a `quota` hold.
   */
  hold: 'quota' | 'refresh' | null;
}

type Availability = Pick<TokenHandout, 'available' | 'availableAt'>;

const AVAILABLE: Availability = { available: true, availableAt: null };

/** Several blocks at once: the account is free when the last one lifts. */
function combineAvailability(...parts: Availability[]): Availability {
  const blocking = parts.filter((part) => !part.available);
  if (blocking.length === 0) return AVAILABLE;
  const lifts = blocking.map((part) =>
    part.availableAt ? Date.parse(part.availableAt) : Number.NaN,
  );
  return {
    available: false,
    availableAt: lifts.every(Number.isFinite)
      ? new Date(Math.max(...lifts)).toISOString()
      : null,
  };
}

/** Which block holds an account back: the quota's, which no consumer may
 * bypass, before the floor's. */
function holdOf(
  quota: Availability,
  lifetime: Availability,
): TokenHandout['hold'] {
  if (!quota.available) return 'quota';
  return lifetime.available ? null : 'refresh';
}

/** One account of a hand-out, before the pool settles its floor. */
interface AssessedHandout {
  handout: Omit<TokenHandout, 'available' | 'availableAt' | 'hold'>;
  quota: Availability;
  lifetime: Availability;
  refreshAtMs: number | null;
}

/**
 * The hand-out floor holds an account back only while another account of
 * its vendor can take new work — an active one whose quota and planned
 * refresh both allow it. When none can, the held-back account with the
 * latest planned refresh, the most life left, is handed out anyway: a turn
 * the refresh may cut, and that then resumes on a fresh token, beats a pool
 * that refuses all work until the refresh lands. A pool of one account is
 * never held back by the floor.
 */
function releaseLastServable(entries: readonly AssessedHandout[]): void {
  const byVendor = new Map<ProviderId, AssessedHandout[]>();
  for (const entry of entries) {
    const group = byVendor.get(entry.handout.provider) ?? [];
    group.push(entry);
    byVendor.set(entry.handout.provider, group);
  }
  for (const group of byVendor.values()) {
    const servable = group.filter(
      (entry) => entry.handout.status === 'active' && entry.quota.available,
    );
    if (servable.some((entry) => entry.lifetime.available)) continue;
    let best: AssessedHandout | undefined;
    for (const entry of servable) {
      if (
        best === undefined ||
        (entry.refreshAtMs ?? -Infinity) > (best.refreshAtMs ?? -Infinity)
      ) {
        best = entry;
      }
    }
    if (best !== undefined) best.lifetime = AVAILABLE;
  }
}

function quotaAvailability(
  usage: StoredAccount['usage'],
  nowMs: number,
): Availability {
  const checkedAt = usage ? Date.parse(usage.checkedAt) : Number.NaN;
  if (
    !usage ||
    !Number.isFinite(checkedAt) ||
    checkedAt > nowMs ||
    nowMs - checkedAt >= USAGE_AVAILABILITY_MAX_AGE_MS
  ) {
    return AVAILABLE;
  }
  const full = usage.windows.filter(
    (window) =>
      window.kind !== 'scoped' &&
      window.utilization !== null &&
      Number.isFinite(window.utilization) &&
      window.utilization >= 100,
  );
  const exhausted = full.filter((window) => {
    const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
    return !Number.isFinite(resetsAt) || resetsAt > nowMs;
  });
  if (exhausted.length === 0) {
    // An explicit flag can be authoritative even when percentages are
    // rounded or absent. Only a previously full window's reset establishes
    // recovery; an unrelated sub-100 window cannot tell when it clears.
    return {
      available: usage.limited !== true || full.length > 0,
      availableAt: null,
    };
  }
  const resets = exhausted.map((window) =>
    window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN,
  );
  return {
    available: false,
    availableAt: resets.every(Number.isFinite)
      ? new Date(Math.max(...resets)).toISOString()
      : null,
  };
}

export interface AccountServiceOptions {
  store: AccountStore;
  providers: ProviderRegistry;
  cipher: TokenCipher;
  /** Refresh an access token at least this many seconds before it expires. */
  tokenRefreshSkewSeconds: number;
  /**
   * Hand a token out as available only while its planned refresh is at
   * least this many seconds away, so work started on it is not cut by the
   * gateway's own refresh. 0 hands out every token.
   */
  tokenMinHandoutSeconds: number;
  /** Floor between two usage reads for one account. */
  usageMinIntervalSeconds: number;
  /** Injectable clock, so the expiry and throttle rules are testable. */
  now?: () => Date;
  /** Injectable refresh stagger; `refreshStaggerShare` by default. */
  refreshStagger?: (accountId: string) => number;
}

/**
 * A started authorization, as the panel needs it: which way it comes back,
 * and what to show meanwhile. The device flow's own handle stays server-side.
 */
export type AuthorizationStart =
  | {
      state: string;
      flow: 'device';
      verificationUrl: string;
      userCode: string;
      expiresAt: string | null;
      pollIntervalSeconds: number;
    }
  | { state: string; flow: 'redirect'; authorizeUrl: string }
  | {
      state: string;
      flow: 'paste';
      authorizeUrl: string;
      pasteStyle: CallbackStyle;
    };

/** Where a started authorization stands. */
export type AuthorizationStatus =
  | { status: 'pending' }
  | { status: 'connected'; account: AccountView }
  | { status: 'failed'; code: AuthorizationFailure };

export interface AccountService {
  list(): Promise<AccountView[]>;
  beginAuthorization(input: {
    provider: ProviderId;
    accountId?: string | null;
    /** A name for the account; the flows that finish alone keep it. */
    label?: string | null;
    /**
     * The origin the browser reaches the gateway on, when that is a
     * loopback address — the vendor may then redirect straight back.
     */
    loopbackOrigin?: string | null;
    /** The browser flow, even where a device flow is offered. */
    preferBrowser?: boolean;
  }): Promise<AuthorizationStart>;
  /** Finish a paste flow with what the person copied out of the browser. */
  completeAuthorization(input: {
    state: string;
    pasted: string;
  }): Promise<AccountView>;
  /** Finish a redirect flow with what the vendor sent to `/callback`. */
  completeRedirect(input: {
    state: string;
    code: string | null;
    error: string | null;
  }): Promise<AuthorizationStatus>;
  /**
   * Where an authorization stands — asking the vendor, for a device code
   * whose poll interval has passed, and finishing it once it is approved.
   */
  authorizationStatus(state: string): Promise<AuthorizationStatus>;
  remove(id: string): Promise<boolean>;
  cliCommand(id: string): Promise<string | null>;
  /**
   * One background pass: refresh every token whose planned refresh is due,
   * and every usage reading past its floor.
   */
  refreshAll(): Promise<void>;
  /**
   * Access tokens, each refreshed first if its planned refresh is due — and
   * no other. Naming a provider narrows the pool to that vendor's accounts —
   * and refreshes only those, so `/api/tokens/anthropic` never spends
   * OpenAI's rate budget.
   */
  handOutTokens(provider?: ProviderId): Promise<TokenHandout[]>;
}

export function createAccountService(
  options: AccountServiceOptions,
): AccountService {
  const { store, providers, cipher } = options;
  const now = options.now ?? (() => new Date());
  const refreshStagger = options.refreshStagger ?? refreshStaggerShare;

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
  /** Panel, token hand-outs and the timer share each account's metrics call. */
  const readingUsage = new Map<string, Promise<StoredAccount>>();
  /** When each account's last refresh failed for a reason that passes. */
  const refreshFailedAt = new Map<string, number>();
  /** Refreshes in flight, and when the vendor last answered one, by vendor:
   * what `REFRESH_SPACING_MS` counts from. */
  const vendorRefreshing = new Map<ProviderId, number>();
  const vendorRefreshedAt = new Map<ProviderId, number>();

  /** When the account's current access token was issued, if known. */
  function issuedAtMs(account: StoredAccount): number {
    return account.lastRefreshedAt
      ? Date.parse(account.lastRefreshedAt)
      : Number.NaN;
  }

  /**
   * When this account's access token is due for refresh — the skew before
   * the vendor's expiry, brought forward by the account's own share of the
   * spread (`REFRESH_SPREAD_SHARE`). The end of the token's usable life for
   * whoever holds it. Null when the vendor stated no expiry.
   */
  function plannedRefreshMs(account: StoredAccount): number | null {
    const expiresAt = account.expiresAt
      ? Date.parse(account.expiresAt)
      : Number.NaN;
    if (!Number.isFinite(expiresAt)) return null;
    const skewPoint = expiresAt - options.tokenRefreshSkewSeconds * 1000;
    // Only the part of the lifetime before the skew point is spread over,
    // so a planned refresh never lands before the token was issued.
    const window = skewPoint - issuedAtMs(account);
    const spread =
      Number.isFinite(window) && window > 0 ? window * REFRESH_SPREAD_SHARE : 0;
    return skewPoint - spread * refreshStagger(account.id);
  }

  /** Whether an access token's planned refresh has come, or it has none. */
  function needsRefresh(account: StoredAccount): boolean {
    if (account.status === 'expired') return false;
    const failedAt = refreshFailedAt.get(account.id);
    if (
      failedAt !== undefined &&
      now().getTime() - failedAt < REFRESH_RETRY_PAUSE_MS
    ) {
      return false;
    }
    const refreshAt = plannedRefreshMs(account);
    return (
      account.status === 'error' ||
      refreshAt === null ||
      refreshAt <= now().getTime()
    );
  }

  /**
   * The hand-out floor: an account whose planned refresh is closer than
   * `tokenMinHandoutSeconds` waits for that refresh instead of handing out a
   * token the refresh would end mid-work — unless no other account of the
   * vendor can serve (`releaseLastServable`). A token whose whole planned
   * life is shorter than the floor is handed out until its refresh is due:
   * the next one would be no longer. An `expired` account is left to its status, which already
   * says it cannot serve.
   */
  function lifetimeAvailability(
    account: StoredAccount,
    nowMs: number,
  ): Availability {
    const floorMs = options.tokenMinHandoutSeconds * 1000;
    const refreshAt = plannedRefreshMs(account);
    if (
      floorMs <= 0 ||
      account.status === 'expired' ||
      refreshAt === null ||
      refreshAt - nowMs >= floorMs ||
      (refreshAt > nowMs && refreshAt - issuedAtMs(account) <= floorMs)
    ) {
      return AVAILABLE;
    }
    return {
      available: false,
      availableAt: refreshAt > nowMs ? new Date(refreshAt).toISOString() : null,
    };
  }

  /**
   * Whether a due refresh waits for its turn: another account of the vendor
   * is being refreshed, or was moments ago (`REFRESH_SPACING_MS`). Never past
   * the skew point, and never for a token with no stated expiry.
   */
  function waitsForSpacing(account: StoredAccount, nowMs: number): boolean {
    const refreshedAt = vendorRefreshedAt.get(account.provider);
    const busy =
      (vendorRefreshing.get(account.provider) ?? 0) > 0 ||
      (refreshedAt !== undefined && nowMs - refreshedAt < REFRESH_SPACING_MS);
    if (!busy) return false;
    const expiresAt = account.expiresAt
      ? Date.parse(account.expiresAt)
      : Number.NaN;
    return (
      Number.isFinite(expiresAt) &&
      expiresAt - options.tokenRefreshSkewSeconds * 1000 > nowMs
    );
  }

  /**
   * Refresh the access token when its planned refresh has come, or it is
   * gone — one account of a vendor at a time (`waitsForSpacing`).
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
    if (waitsForSpacing(account, now().getTime())) {
      return Promise.resolve(account);
    }
    const vendor = account.provider;
    vendorRefreshing.set(vendor, (vendorRefreshing.get(vendor) ?? 0) + 1);
    const run = refreshStored(account).finally(() => {
      refreshing.delete(account.id);
      vendorRefreshing.set(vendor, (vendorRefreshing.get(vendor) ?? 1) - 1);
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
      // The vendor has answered — and revoked the token it replaced.
      vendorRefreshedAt.set(account.provider, now().getTime());
      refreshFailedAt.delete(account.id);
      const updated = await store.updateAccount(account.id, (row) => {
        // Reauthorization may have replaced this grant while the vendor was
        // answering. Never rotate the old grant over the replacement.
        if (row.refreshToken !== account.refreshToken) return;
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
      console.warn(
        `[ai-gateway] refresh ${refused ? 'refused' : 'failed'} for ${account.provider} account ${account.id}:`,
        error instanceof Error ? error.message : error,
      );
      const updated = await store.updateAccount(account.id, (row) => {
        if (row.refreshToken !== account.refreshToken) return;
        if (!refused) refreshFailedAt.set(account.id, now().getTime());
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
      if (row.accessToken !== account.accessToken) return;
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
  function refreshUsage(
    account: StoredAccount,
    { force = false } = {},
  ): Promise<StoredAccount> {
    const inFlight = readingUsage.get(account.id);
    if (inFlight) {
      return force
        ? inFlight.then(() => refreshUsage(account, { force: true }))
        : inFlight;
    }
    const run = refreshStoredUsage(account, force).finally(() => {
      readingUsage.delete(account.id);
    });
    readingUsage.set(account.id, run);
    return run;
  }

  function usageAttemptIsNewerThanReading(account: StoredAccount): boolean {
    if (!account.usage) return false;
    const attempted = account.usageAttemptedAt
      ? Date.parse(account.usageAttemptedAt)
      : Number.NaN;
    const checked = Date.parse(account.usage.checkedAt);
    return (
      Number.isFinite(attempted) &&
      Number.isFinite(checked) &&
      attempted > checked
    );
  }

  async function refreshStoredUsage(
    account: StoredAccount,
    force: boolean,
  ): Promise<StoredAccount> {
    const stored = await store.getAccount(account.id);
    if (!stored) return account;
    const current = await ensureFresh(stored);
    // A persisted error has already failed a refresh. Keep it out of usage
    // polling until a later refresh succeeds; an error produced by this
    // call's initial refresh still gets one final usage read, preserving the
    // existing transient-refresh behaviour.
    if (
      current.status === 'expired' ||
      (current.status === 'error' &&
        stored.status === 'error' &&
        stored.usageAttemptedAt !== null &&
        (account.status === 'error' ||
          !stored.usage ||
          usageAttemptIsNewerThanReading(stored)))
    )
      return current;
    if (
      current.status === 'error' &&
      current.expiresAt &&
      Date.parse(current.expiresAt) <= now().getTime()
    )
      return current;

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

    try {
      const accessToken = cipher.open(current.accessToken);
      // Neither provider needs a separate profile lookup to authenticate its
      // usage call. Run both reads together so a slow profile does not add a
      // second network timeout to every token hand-out. The polling floor
      // above applies to both, including failed profile attempts.
      const [, reading] = await Promise.all([
        ensureIdentity(current),
        providerFor(current).fetchUsage({
          accessToken,
          accountId: current.accountId,
        }),
      ]);
      const updated = await store.updateAccount(current.id, (row) => {
        if (row.accessToken !== current.accessToken) return;
        const at = now().toISOString();
        row.usage = {
          windows: reading.windows,
          checkedAt: at,
          limited: reading.limited ?? null,
        };
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
      // Metrics have their own rate limit and availability. A failed reading
      // does not prove that inference is broken, so preserve lifecycle state
      // and the last real reading. A corrupt local token is different: only
      // signing in again can repair it.
      console.warn(
        `[ai-gateway] usage read failed for ${current.provider} account ${current.id}:`,
        error instanceof Error ? error.message : error,
      );
      const rejected =
        error instanceof ProviderError &&
        error.code === 'access_token_rejected';
      const updated = await store.updateAccount(current.id, (row) => {
        if (row.accessToken !== current.accessToken) return;
        row.usageAttemptedAt = now().toISOString();
        if (error instanceof CipherError) row.status = 'expired';
        // A refresh refusal can win this race while the old generation's
        // usage request is still in flight. Preserve that terminal state;
        // turning it back into `error` would make the late 401 spend the
        // refused refresh token a second time.
        else if (rejected && row.status !== 'expired') row.status = 'error';
      });
      if (rejected && updated?.status === 'error') return ensureFresh(updated);
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
      if (row.provider !== pending.provider) {
        throw new AccountError(
          'unknown_account',
          'That account does not exist for this provider.',
        );
      }
      row.accessToken = cipher.seal(exchange.tokens.accessToken);
      row.refreshToken = cipher.seal(exchange.tokens.refreshToken);
      row.expiresAt = exchange.tokens.expiresAt;
      row.scopes = exchange.tokens.scopes;
      row.status = 'active';
      row.lastRefreshedAt = timestamp;
      // Reauthorization may select another vendor account. Only the new
      // grant can say whose identity and quota belong to these credentials.
      row.accountEmail = null;
      row.accountId = null;
      row.subscription = null;
      row.identityCheckedAt = null;
      row.usage = null;
      row.usageAttemptedAt = null;
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
      plan: null,
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

  /**
   * Exchange a claimed authorization's code and land the grant — the one path
   * every flow finishes through, whoever brought the code back — then record
   * how it ended, so a panel asking after it reads the same outcome.
   */
  async function finish(
    pending: PendingAuthorization,
    grant: { code: string; codeVerifier: string; redirectUri: string },
  ): Promise<StoredAccount> {
    let exchange: ProviderExchange;
    try {
      exchange = await providers[pending.provider].exchangeCode({
        code: grant.code,
        codeVerifier: grant.codeVerifier,
        redirectUri: grant.redirectUri,
        state: pending.state,
      });
    } catch (error) {
      await store.settlePending(pending.state, {
        phase: 'failed',
        failure: 'exchange_failed',
      });
      throw new AccountError(
        'exchange_failed',
        error instanceof ProviderError
          ? error.message
          : 'The authorization code could not be exchanged.',
        { cause: error },
      );
    }
    const account = await storeGrant(pending, exchange, pending.label);
    await store.settlePending(pending.state, {
      phase: 'connected',
      accountId: account.id,
    });
    return account;
  }

  /** `finish`, answered as a status rather than thrown. */
  async function finishedStatus(
    pending: PendingAuthorization,
    grant: { code: string; codeVerifier: string; redirectUri: string },
  ): Promise<AuthorizationStatus> {
    try {
      return {
        status: 'connected',
        account: toAccountView(await finish(pending, grant)),
      };
    } catch (error) {
      if (error instanceof AccountError && error.code !== 'unknown_account') {
        return { status: 'failed', code: error.code };
      }
      throw error;
    }
  }

  /** What a stored authorization says about itself. */
  async function statusOf(
    pending: PendingAuthorization,
  ): Promise<AuthorizationStatus> {
    if (pending.phase === 'connected' && pending.accountId) {
      const account = await store.getAccount(pending.accountId);
      // Connected, then removed before anyone asked: nothing to show.
      return account
        ? { status: 'connected', account: toAccountView(account) }
        : { status: 'failed', code: 'unknown_state' };
    }
    if (pending.phase === 'failed') {
      return { status: 'failed', code: asFailure(pending.failure) };
    }
    return { status: 'pending' };
  }

  /** The outcome a concurrent completion recorded, when this one lost to it. */
  async function statusAfterRace(state: string): Promise<AuthorizationStatus> {
    const latest = await store.getPending(state);
    return latest
      ? statusOf(latest)
      : { status: 'failed', code: 'unknown_state' };
  }

  /** Device codes being put to their vendor right now, by state. */
  const polling = new Map<string, Promise<AuthorizationStatus>>();
  /** When each device code was last put to its vendor. */
  const polledAt = new Map<string, number>();

  /**
   * Ask the vendor whether a device code was approved — at most once per the
   * interval the vendor asked for, one poll at a time per code, however many
   * panels are asking — and finish the authorization the moment it was.
   */
  function pollDevice(
    pending: PendingAuthorization,
  ): Promise<AuthorizationStatus> {
    const inFlight = polling.get(pending.state);
    if (inFlight) return inFlight;
    const run = pollDeviceOnce(pending).finally(() => {
      polling.delete(pending.state);
    });
    polling.set(pending.state, run);
    return run;
  }

  async function pollDeviceOnce(
    pending: PendingAuthorization,
  ): Promise<AuthorizationStatus> {
    const provider = providers[pending.provider];
    if (
      !provider.pollDeviceAuthorization ||
      !pending.deviceAuthId ||
      !pending.userCode
    ) {
      return { status: 'failed', code: 'unknown_state' };
    }

    const nowMs = now().getTime();
    const expiresAt = pending.expiresAt
      ? new Date(pending.expiresAt).getTime()
      : Number.NaN;
    if (Number.isFinite(expiresAt) && nowMs >= expiresAt) {
      if (await store.claimPending(pending.state)) {
        await store.settlePending(pending.state, {
          phase: 'failed',
          failure: 'expired',
        });
        polledAt.delete(pending.state);
        return { status: 'failed', code: 'expired' };
      }
      return statusAfterRace(pending.state);
    }

    const intervalMs = (pending.pollIntervalSeconds ?? 5) * 1000;
    const last = polledAt.get(pending.state);
    if (last !== undefined && nowMs - last < intervalMs) {
      return { status: 'pending' };
    }
    polledAt.set(pending.state, nowMs);

    const poll = await provider.pollDeviceAuthorization({
      deviceAuthId: cipher.open(pending.deviceAuthId),
      userCode: pending.userCode,
    });
    if (poll.status === 'pending') return { status: 'pending' };

    const claimed = await store.claimPending(pending.state);
    if (!claimed) return statusAfterRace(pending.state);
    polledAt.delete(pending.state);
    if (poll.status === 'refused') {
      await store.settlePending(pending.state, {
        phase: 'failed',
        failure: 'denied',
      });
      return { status: 'failed', code: 'denied' };
    }
    return finishedStatus(claimed, poll);
  }

  return {
    async list() {
      const accounts = await store.listAccounts();
      const refreshed = await Promise.all(
        accounts.map((account) => refreshUsage(account)),
      );
      return refreshed.map(toAccountView);
    },

    async beginAuthorization({
      provider: providerId,
      accountId = null,
      label = null,
      loopbackOrigin = null,
      preferBrowser = false,
    }) {
      const target = accountId ? await store.getAccount(accountId) : null;
      if (accountId && (!target || target.provider !== providerId)) {
        throw new AccountError(
          'unknown_account',
          'That account does not exist for this provider.',
        );
      }
      const state = generateState();
      let request: AuthorizationRequest;
      try {
        request = await providers[providerId].beginAuthorization(state, {
          loopbackRedirectUri: loopbackRedirectUri(loopbackOrigin),
          preferBrowser,
        });
      } catch (error) {
        throw new AccountError(
          'unavailable',
          error instanceof ProviderError
            ? error.message
            : 'The authorization could not be started.',
          { cause: error },
        );
      }

      await store.prunePending(PENDING_AUTHORIZATION_TTL_MS, now());
      const entry = {
        state,
        provider: providerId,
        targetAccountId: accountId,
        createdAt: now().toISOString(),
        label: label?.trim() || null,
        phase: 'open' as const,
        accountId: null,
        failure: null,
      };
      if (request.flow === 'device') {
        await store.addPending({
          ...entry,
          flow: 'device',
          // Unused by the device flow — OpenAI hands the verifier back with
          // the approved code — and filled only because 0.5.53 and earlier
          // require both, so a rolled-back gateway can still read the file.
          codeVerifier: 'device',
          redirectUri: request.verificationUrl,
          deviceAuthId: cipher.seal(request.deviceAuthId),
          userCode: request.userCode,
          pollIntervalSeconds: request.intervalSeconds,
          expiresAt: request.expiresAt,
        });
        return {
          state,
          flow: 'device',
          verificationUrl: request.verificationUrl,
          userCode: request.userCode,
          expiresAt: request.expiresAt,
          pollIntervalSeconds: request.intervalSeconds,
        };
      }

      await store.addPending({
        ...entry,
        flow: request.flow,
        codeVerifier: request.codeVerifier,
        redirectUri: request.redirectUri,
        deviceAuthId: null,
        userCode: null,
        pollIntervalSeconds: null,
        expiresAt: null,
      });
      return request.flow === 'redirect'
        ? { state, flow: 'redirect', authorizeUrl: request.authorizeUrl }
        : {
            state,
            flow: 'paste',
            authorizeUrl: request.authorizeUrl,
            pasteStyle: request.pasteStyle,
          };
    },

    async completeAuthorization({ state, pasted }) {
      const pending = await store.getPending(state);
      // A device code finishes on its own; only a flow whose code comes back
      // through the browser takes a paste — a redirect flow too, for the
      // browser that could not load the loopback page it was sent to.
      if (!pending || pending.phase !== 'open' || pending.flow === 'device') {
        throw new AccountError(
          'unknown_state',
          'That authorization has expired or was already completed.',
        );
      }

      const parsed = providers[pending.provider].parseCallback(pasted);
      // A paste that does not parse leaves the attempt open: the person
      // copied the wrong thing, which a second try can fix.
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

      const claimed = await store.claimPending(state);
      if (!claimed) {
        throw new AccountError(
          'unknown_state',
          'That authorization has expired or was already completed.',
        );
      }
      return toAccountView(
        await finish(claimed, {
          code: parsed.code,
          codeVerifier: claimed.codeVerifier,
          redirectUri: claimed.redirectUri,
        }),
      );
    },

    async completeRedirect({ state, code, error }) {
      const pending = await store.getPending(state);
      if (!pending || pending.flow === 'device') {
        return { status: 'failed', code: 'unknown_state' };
      }
      // A reload of `/callback` after it finished reads the outcome again.
      if (pending.phase !== 'open') return statusOf(pending);

      const claimed = await store.claimPending(state);
      if (!claimed) return statusAfterRace(state);
      if (error || !code) {
        const failure = error === 'access_denied' ? 'denied' : 'missing_code';
        await store.settlePending(state, { phase: 'failed', failure });
        return { status: 'failed', code: failure };
      }
      return finishedStatus(claimed, {
        code,
        codeVerifier: claimed.codeVerifier,
        redirectUri: claimed.redirectUri,
      });
    },

    async authorizationStatus(state) {
      const pending = await store.getPending(state);
      if (!pending) return { status: 'failed', code: 'unknown_state' };
      if (pending.flow === 'device' && pending.phase === 'open') {
        return pollDevice(pending);
      }
      return statusOf(pending);
    },

    remove(id) {
      return store.deleteAccount(id);
    },

    async cliCommand(id) {
      const account = await store.getAccount(id);
      if (!account) return null;
      const fresh = await ensureFresh(account);
      if (fresh.status !== 'active') {
        throw new AccountError(
          'unavailable',
          'This account is not currently available.',
        );
      }
      try {
        return providerFor(fresh).cliCommand(
          cipher.open(fresh.accessToken),
          fresh.accountId,
        );
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        throw new AccountError('unavailable', error.message, { cause: error });
      }
    },

    async refreshAll() {
      await store.prunePending(PENDING_AUTHORIZATION_TTL_MS, now());
      await Promise.all(
        (await store.listAccounts()).map((account) => refreshUsage(account)),
      );
    },

    async handOutTokens(provider) {
      const accounts = (await store.listAccounts()).filter(
        (account) => provider === undefined || account.provider === provider,
      );
      const assessed = await Promise.all(
        accounts.map(async (account): Promise<AssessedHandout | null> => {
          // Keep token rotation independent of an already-running usage read.
          // Once it finishes, use the stored row so neither an old token nor a
          // concurrently removed account can escape from a held snapshot.
          await ensureFresh(account);
          await refreshUsage(account);
          const fresh = await store.getAccount(account.id);
          if (!fresh) return null;
          let accessToken: string;
          try {
            accessToken = cipher.open(fresh.accessToken);
          } catch (error) {
            if (!(error instanceof CipherError)) throw error;
            await store.updateAccount(fresh.id, (row) => {
              row.status = 'expired';
            });
            console.warn(
              `[ai-gateway] unreadable credential for ${fresh.provider} account ${fresh.id}`,
            );
            return null;
          }
          const nowMs = now().getTime();
          const refreshAtMs = plannedRefreshMs(fresh);
          return {
            handout: {
              id: fresh.id,
              provider: fresh.provider,
              label: fresh.label,
              accountEmail: fresh.accountEmail,
              accountId: fresh.accountId,
              status: fresh.status,
              accessToken,
              expiresAt: fresh.expiresAt,
              refreshAt:
                refreshAtMs === null
                  ? null
                  : new Date(refreshAtMs).toISOString(),
              scopes: fresh.scopes,
              usage: fresh.usage,
            },
            quota: quotaAvailability(fresh.usage, nowMs),
            lifetime: lifetimeAvailability(fresh, nowMs),
            refreshAtMs,
          };
        }),
      );
      const pool = assessed.filter(
        (entry): entry is AssessedHandout => entry !== null,
      );
      releaseLastServable(pool);
      return pool.map(({ handout, quota, lifetime }) =>
        Object.assign(handout, combineAvailability(quota, lifetime), {
          hold: holdOf(quota, lifetime),
        }),
      );
    },
  };
}
