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
}

export interface AccountView {
  id: string;
  provider: ProviderId;
  label: string;
  accountEmail: string | null;
  plan: string | null;
  status: AccountStatus;
  expiresAt: string | null;
  scopes: string | null;
  createdAt: string;
  lastRefreshedAt: string | null;
  usage: { windows: UsageWindow[]; checkedAt: string } | null;
}

export interface ProviderSummary {
  id: ProviderId;
  callbackStyle: CallbackStyle;
}

export interface AuthorizationStart {
  state: string;
  authorizeUrl: string;
  callbackStyle: CallbackStyle;
}

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch (error) {
    throw new ApiError(
      'unreachable',
      error instanceof Error ? error.message : 'The gateway did not answer.',
      0,
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
    throw new ApiError(
      envelope?.code ?? 'request_failed',
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

  authorize: (input: { provider: ProviderId; accountId?: string | null }) =>
    request<AuthorizationStart>('/api/accounts/authorize', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  complete: (input: { state: string; pasted: string; label?: string | null }) =>
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
