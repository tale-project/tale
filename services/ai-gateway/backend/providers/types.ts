/**
 * The provider contract.
 *
 * Every subscription this gateway pools — a Claude Pro/Max account, a ChatGPT
 * Plus/Pro account — is reached through the same five moves: send the person to
 * an authorize URL, trade the code they bring back for tokens, keep those
 * tokens fresh, read who they belong to, and read how much of the plan is
 * spent. A provider module is those five moves plus the constants its vendor
 * publishes; everything above this file is provider-agnostic, so a third
 * subscription is a new module and one registry line, not a new code path.
 */

/**
 * The one capability a provider needs from its host: make an HTTP call.
 *
 * Narrower than `typeof fetch` on purpose — the runtime's own signature
 * carries extras (Bun's `preconnect`) that a test stub has no business
 * implementing, and nothing here calls anything but the function itself.
 */
export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** The subscriptions this gateway knows how to hold. */
export const PROVIDER_IDS = ['anthropic', 'openai'] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return (
    typeof value === 'string' &&
    (PROVIDER_IDS as readonly string[]).includes(value)
  );
}

/**
 * One rate-limit window a provider reports for an account.
 *
 * Vendors disagree on names and shapes — Anthropic answers `five_hour` and
 * `seven_day` plus per-model entries, OpenAI a `primary_window` and a
 * `secondary_window` measured in seconds — so each module maps its own vendor
 * payload onto these three kinds. The panel translates `session` and `weekly`;
 * a `scoped` window carries the vendor's own name for the thing it caps.
 */
export interface UsageWindow {
  kind: 'session' | 'weekly' | 'scoped';
  /** The vendor's name for a `scoped` window (a model, a metered limit). */
  label: string | null;
  /** Percent of the window spent, 0–100, or null when the vendor omits it. */
  utilization: number | null;
  /** ISO-8601 instant the window rolls over, or null when the vendor omits it. */
  resetsAt: string | null;
  /**
   * How long the window runs, in seconds. OpenAI reports it outright;
   * Anthropic names it in the key it answers under (`five_hour`, `seven_day`)
   * and in a per-model limit's `group`. Null when neither says — the panel
   * needs it to draw how far through the window the clock already is, and
   * without it there is nothing honest to draw.
   */
  windowSeconds: number | null;
}

/** A token pair as this gateway stores it, whatever the vendor called it. */
export interface ProviderTokens {
  accessToken: string;
  refreshToken: string;
  /** ISO-8601 expiry of the access token; null when the vendor does not say. */
  expiresAt: string | null;
  scopes: string | null;
}

/**
 * The subscription an account runs on, in the vendor's own ids — `max`,
 * `pro`, `plus`, `prolite` — never a rendering of them. The panel owns how a
 * plan reads, and an id it has no name for still says something true.
 */
export interface Subscription {
  /** The vendor's id for the plan. */
  plan: string;
  /** The usage multiple the plan is sold at (`20x` on a Max plan), or null. */
  tier: string | null;
}

/** Who a credential belongs to, as far as the provider will say. */
export interface ProviderIdentity {
  email: string | null;
  /**
   * The vendor's own handle for the account, when later calls need it —
   * OpenAI's `chatgpt_account_id` rides its usage request as a header.
   */
  accountId: string | null;
  /** The plan behind the account, when the vendor reports one. */
  subscription: Subscription | null;
}

/**
 * One usage read: the windows, plus the plan they are measured against when
 * the answer names it — ChatGPT's does (`plan_type`), so a plan change shows
 * on the next read rather than on the next token refresh.
 */
export interface UsageReading {
  windows: UsageWindow[];
  subscription: Subscription | null;
}

/** What a stored account hands a provider call. */
export interface ProviderCredential {
  accessToken: string;
  accountId: string | null;
}

/** A token exchange or refresh: the tokens, plus identity when it rode along. */
export interface ProviderExchange {
  tokens: ProviderTokens;
  identity: ProviderIdentity | null;
}

/**
 * What the person pastes back when a flow comes back by hand. `code` means the
 * vendor's callback page prints it for copying (Anthropic's console does).
 * `redirect-url` means the browser lands on a loopback URL that may not
 * answer, and the whole address bar is the payload (OpenAI's Codex client
 * redirects to `http://localhost:1455/...`).
 */
export type CallbackStyle = 'code' | 'redirect-url';

/**
 * An authorization this gateway started and is waiting to have completed, in
 * one of the three ways a grant can come back:
 *
 * - `device` — the vendor shows a sign-in page where the person enters a
 *   one-time code, and this gateway asks the vendor, on its own, whether the
 *   code was approved. Nothing comes back through the browser at all, so it
 *   works wherever the gateway runs. OpenAI's Codex client offers it.
 * - `redirect` — the vendor sends the browser to this gateway's own
 *   `/callback`, which finishes the grant. Only possible where the vendor
 *   allows the redirect: Anthropic's client redirects only to a loopback
 *   address, so this is the flow when the browser reaches the gateway on one.
 * - `paste` — the vendor sends the browser somewhere this gateway cannot
 *   listen, and the person carries the result back by hand.
 */
export type AuthorizationRequest =
  | {
      flow: 'redirect' | 'paste';
      authorizeUrl: string;
      /** PKCE verifier, held until the code comes back. */
      codeVerifier: string;
      /** Echoed verbatim in the exchange; the vendor matches it to the grant. */
      redirectUri: string;
      /** What a `paste` flow asks the person for. */
      pasteStyle: CallbackStyle;
    }
  | {
      flow: 'device';
      /** Where the person signs in and enters the code. */
      verificationUrl: string;
      /** The one-time code the person enters there. */
      userCode: string;
      /** The vendor's handle for the pending code; a secret while it lives. */
      deviceAuthId: string;
      /** How often the vendor wants to be asked, in seconds. */
      intervalSeconds: number;
      /** When the code stops being accepted, when the vendor says. */
      expiresAt: string | null;
    };

/** Everything a provider needs to pick a flow for one authorization. */
export interface BeginAuthorizationOptions {
  /**
   * This gateway's own `/callback`, when the browser reaches the gateway on a
   * loopback address — so a vendor that redirects only to loopback can send
   * the browser straight back here. Null anywhere else.
   */
  loopbackRedirectUri: string | null;
  /** The browser flow, even where the provider offers a device flow. */
  preferBrowser: boolean;
}

/** Where a device authorization stands, as the vendor answers a poll. */
export type DevicePoll =
  | { status: 'pending' }
  | {
      status: 'approved';
      /** Exchanged like any authorization code. */
      code: string;
      codeVerifier: string;
      redirectUri: string;
    }
  | { status: 'refused' };

export interface Provider {
  readonly id: ProviderId;
  /**
   * A ready-to-run command that starts the vendor's CLI on this token —
   * `ANTHROPIC_AUTH_TOKEN=… claude` for Claude Code, `CODEX_ACCESS_TOKEN=…
   * codex` for Codex.
   */
  cliCommand(accessToken: string): string;
  /** Start an authorization in the best flow the vendor allows here. */
  beginAuthorization(
    state: string,
    options: BeginAuthorizationOptions,
  ): Promise<AuthorizationRequest>;
  /** Ask whether a device code was approved; only a device-flow provider. */
  pollDeviceAuthorization?(device: {
    deviceAuthId: string;
    userCode: string;
  }): Promise<DevicePoll>;
  /**
   * Pull the authorization code (and the state the vendor echoed, when it
   * did) out of whatever the person pasted back.
   */
  parseCallback(pasted: string): { code: string; state: string | null };
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    state: string;
  }): Promise<ProviderExchange>;
  refresh(refreshToken: string): Promise<ProviderExchange>;
  /** Only where identity needs a call of its own; OpenAI reads its id_token. */
  fetchIdentity?(credential: ProviderCredential): Promise<ProviderIdentity>;
  fetchUsage(credential: ProviderCredential): Promise<UsageReading>;
}

/**
 * A provider call that failed in a way the panel should name.
 *
 * Two refresh failures mean different things. `refresh_rejected` is the
 * vendor refusing the grant (a 400/401/403 — revoked, reused, expired): the
 * refresh token is spent and only a new sign-in brings the account back.
 * `refresh_failed` is everything else — a rate limit, an outage, a network
 * that did not answer — after which the same token works on the next try.
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly code:
      | 'authorization_failed'
      | 'refresh_failed'
      | 'refresh_rejected'
      | 'identity_failed'
      | 'usage_failed',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ProviderError';
  }
}
