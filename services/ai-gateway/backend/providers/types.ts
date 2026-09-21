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
 * `seven_day` plus per-model entries, OpenAI answers a `primary` and a
 * `secondary` window measured in minutes — so each module maps its own vendor
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
}

/** A token pair as this gateway stores it, whatever the vendor called it. */
export interface ProviderTokens {
  accessToken: string;
  refreshToken: string;
  /** ISO-8601 expiry of the access token; null when the vendor does not say. */
  expiresAt: string | null;
  scopes: string | null;
}

/** Who a credential belongs to, as far as the provider will say. */
export interface ProviderIdentity {
  email: string | null;
  /**
   * The vendor's own handle for the account, when later calls need it —
   * OpenAI's `chatgpt_account_id` rides its usage request as a header.
   */
  accountId: string | null;
  /** The subscription tier, when the vendor reports one. */
  plan: string | null;
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

/** An authorization this gateway started and is waiting to have completed. */
export interface AuthorizationRequest {
  authorizeUrl: string;
  /** PKCE verifier, held until the code comes back. */
  codeVerifier: string;
  /** Echoed verbatim in the exchange; the vendor matches it against the grant. */
  redirectUri: string;
}

/**
 * How the person gets the authorization code out of the browser and back into
 * the panel. `code` means the vendor's callback page prints it for copying
 * (Anthropic's console does). `redirect-url` means the browser lands on a
 * loopback URL that may not answer, and the whole address bar is the payload
 * (OpenAI's Codex client redirects to `http://localhost:1455/...`).
 */
export type CallbackStyle = 'code' | 'redirect-url';

export interface Provider {
  readonly id: ProviderId;
  /** How the panel asks for the code back. */
  readonly callbackStyle: CallbackStyle;
  /**
   * The environment variable that hands this provider's access token to its
   * own CLI — `ANTHROPIC_AUTH_TOKEN` for Claude Code, `CODEX_ACCESS_TOKEN`
   * for Codex.
   */
  readonly cliTokenEnvVar: string;
  /** A ready-to-run command that starts the vendor's CLI on this token. */
  cliCommand(accessToken: string): string;
  /** Build the authorize URL the person opens, with a fresh PKCE pair. */
  beginAuthorization(state: string): AuthorizationRequest;
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
  fetchUsage(credential: ProviderCredential): Promise<UsageWindow[]>;
}

/** A provider call that failed in a way the panel should name. */
export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly code:
      | 'authorization_failed'
      | 'refresh_failed'
      | 'identity_failed'
      | 'usage_failed',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ProviderError';
  }
}
