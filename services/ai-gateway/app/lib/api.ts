/**
 * The panel's view of the gateway API.
 *
 * Every call goes through one request helper so a failure always arrives as
 * an `ApiError` carrying the backend's own code — the panel translates that
 * code rather than rendering an English message the server wrote.
 */

/**
 * The subscriptions this gateway knows how to hold.
 *
 * The panel does not decide the list — `GET /api/providers` does — but it does
 * have to know the ids to type them and to translate them.
 */
const PROVIDER_IDS = ['anthropic', 'openai'] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.some((id) => id === value);
}

export type AccountStatus = 'active' | 'expired' | 'error';

export type CallbackStyle = 'code' | 'redirect-url';

export interface UsageWindow {
  kind: 'session' | 'weekly' | 'scoped';
  label: string | null;
  utilization: number | null;
  resetsAt: string | null;
  /** How long the window runs; what the countdown bar is a fraction of. */
  windowSeconds: number | null;
}

/**
 * The plan an account runs on, in its vendor's own ids (`max`, `prolite`);
 * `tier` is the multiple a plan is sold at (`20x`), when it has one.
 */
export interface Subscription {
  plan: string;
  tier: string | null;
}

export interface AccountView {
  id: string;
  provider: ProviderId;
  label: string;
  accountEmail: string | null;
  subscription: Subscription | null;
  status: AccountStatus;
  expiresAt: string | null;
  scopes: string | null;
  createdAt: string;
  lastRefreshedAt: string | null;
  /**
   * `stale`: the latest attempt to read the figures failed, or the account
   * cannot be read until it is signed in again — they are shown, dimmed,
   * with the time they were read.
   */
  usage: {
    windows: UsageWindow[];
    checkedAt: string;
    stale: boolean;
  } | null;
}

export interface ProviderSummary {
  id: ProviderId;
}

/**
 * A started authorization and the way it comes back: `device` finishes on
 * its own once the person approves the code on the vendor's page; `redirect`
 * sends the browser to the vendor and straight back to this gateway; `paste`
 * needs the person to carry the result back by hand.
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
  | { status: 'failed'; code: string };

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Whether a call was answered by the sign-in in front of the gateway rather
 * than by the gateway: the session that let this page load has run out.
 *
 * Nothing the panel does can renew it. Only a page load passes through the
 * gate's own sign-in — see `reloadPage`.
 */
export function isSignedOut(cause: unknown): boolean {
  return cause instanceof ApiError && cause.code === 'signed_out';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    // No route the panel calls redirects, so a redirect is the deployment's
    // front door answering in the gateway's place: a sign-in gate whose
    // session ran out, sending the browser to its identity provider.
    // Followed, that chain ends on another origin and `fetch` fails exactly
    // as it does on a dropped connection. Held, it is an answer this helper
    // can name.
    response = await fetch(path, { ...init, headers, redirect: 'manual' });
  } catch (error) {
    throw new ApiError(
      'unreachable',
      error instanceof Error ? error.message : 'The gateway did not answer.',
      0,
    );
  }

  // A browser hands a held redirect over as an opaque answer with status 0;
  // a `fetch` outside one shows the 3xx itself.
  if (
    response.type === 'opaqueredirect' ||
    (response.status >= 300 && response.status < 400)
  ) {
    throw new ApiError(
      'signed_out',
      'The sign-in in front of the gateway has run out.',
      response.status,
    );
  }

  // 204 is this API's "done, nothing to say"; every caller that receives one
  // declares `T` as `void`, so there is no shape to parse.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 204 routes are typed `void`
  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope =
      typeof payload === 'object' && payload !== null
        ? (payload as { error?: { code?: string; message?: string } }).error
        : undefined;
    // The gateway has no login of its own, so no route the panel calls
    // answers 401.
    // One without the gateway's envelope is a gate that refuses a request
    // outright instead of redirecting it.
    const code =
      envelope?.code ??
      (response.status === 401 ? 'signed_out' : 'request_failed');
    throw new ApiError(
      code,
      envelope?.message ?? `The gateway answered ${response.status}.`,
      response.status,
    );
  }
  // The one place a JSON body becomes a typed value. The gateway and this
  // client are built and shipped together, so the shape is a contract rather
  // than an unknown third party's answer.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same-build API contract
  return payload as T;
}

export const gatewayApi = {
  providers: () =>
    request<{ providers: ProviderSummary[] }>('/api/providers').then(
      (payload) => payload.providers,
    ),

  accounts: () =>
    request<{ accounts: AccountView[] }>('/api/accounts').then(
      (payload) => payload.accounts,
    ),

  authorize: (input: {
    provider: ProviderId;
    accountId?: string | null;
    label?: string | null;
    /** `browser`: the browser flow, even where a device flow is offered. */
    method?: 'browser';
  }) =>
    request<AuthorizationStart>('/api/accounts/authorize', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  authorizationStatus: (state: string) =>
    request<AuthorizationStatus>(
      `/api/accounts/authorize/${encodeURIComponent(state)}`,
    ),

  complete: (input: { state: string; pasted: string }) =>
    request<{ account: AccountView }>('/api/accounts/complete', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((payload) => payload.account),

  command: (id: string) =>
    request<{ command: string }>(
      `/api/accounts/${encodeURIComponent(id)}/command`,
    ).then((payload) => payload.command),

  remove: (id: string) =>
    request<void>(`/api/accounts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};
