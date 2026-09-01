/**
 * The authorization-code → token exchange.
 *
 * This is the step that must never touch the browser: the code arrives on a
 * front-channel redirect, but it is redeemed here, server to server, with the
 * client secret and the PKCE verifier. The tokens it produces go straight into
 * the encrypted credential envelope — they are not returned to the caller's
 * response, not put in a redirect, and not logged.
 *
 * Scrubbing is structural rather than remembered: the result type carries only
 * a short machine-readable failure code, so there is no path by which a vendor
 * response body (which contains tokens on success and often echoes request
 * material on failure) can reach a log line or an error page. `fetchImpl` is
 * injectable so the whole surface is testable without a network.
 */

import { getNumber, getString, isRecord } from '../../../lib/utils/type-utils';

/** A vendor that cannot answer in this long is failing, not slow. */
const TOKEN_EXCHANGE_TIMEOUT_MS = 15_000;

/**
 * Vendors return short symbolic codes (`invalid_grant`, `invalid_client`). We
 * log only values of that shape and only when short, so a hostile or
 * misconfigured endpoint cannot smuggle a token — or a novel's worth of text —
 * into the deployment log through the `error` field.
 */
const VENDOR_ERROR_CODE_RE = /^[a-z0-9_.-]{1,64}$/i;

export interface Oauth2Tokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  /** Absolute epoch-ms expiry, when the vendor declared a lifetime. */
  readonly expiresAt?: number;
  /** Scopes the vendor actually granted — often narrower than requested. */
  readonly scopes: string[];
  /**
   * Slack returns the installing workspace as `team.id`; it is the routing key
   * for inbound events. Absent for every other vendor, which is why it is read
   * generically instead of switching on the connector.
   */
  readonly teamId?: string;
}

export type TokenExchangeResult =
  | { ok: true; tokens: Oauth2Tokens }
  /**
   * `reason` is the only thing that escapes this module:
   *  - `vendor_rejected` — the vendor refused the code (expired, replayed,
   *    wrong client, redirect mismatch);
   *  - `vendor_unreachable` — transport failure or timeout;
   *  - `malformed_response` — a 2xx that carried no usable access token.
   * `code` is the vendor's symbolic error, present only when it passed the
   * shape check above, and is for the SERVER LOG only.
   */
  | {
      ok: false;
      reason: 'vendor_rejected' | 'vendor_unreachable' | 'malformed_response';
      code?: string;
    };

/** Split a scope string on either separator: OAuth2 uses spaces, Slack commas. */
function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function vendorErrorCode(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const code = getString(payload, 'error');
  return code !== undefined && VENDOR_ERROR_CODE_RE.test(code)
    ? code
    : undefined;
}

/**
 * The single outbound call this module makes, as a type. Narrower than
 * `typeof fetch` on purpose: the caller only ever passes a string URL and an
 * init record, so a test double is a plain function rather than a full
 * re-implementation of the fetch interface.
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface TokenExchangeParams {
  readonly tokenUrl: string;
  readonly code: string;
  /** The SAME redirect_uri sent on the authorize request — vendors compare. */
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly codeVerifier: string;
}

/**
 * Redeem an authorization code. Never throws for a vendor-side outcome — every
 * failure is a typed result the caller can render without leaking anything.
 */
export async function exchangeAuthorizationCode(
  params: TokenExchangeParams,
  fetchImpl: FetchLike = fetch,
): Promise<TokenExchangeResult> {
  // The token endpoint comes from the shipped catalog (schema-validated as a
  // URL), so this is defense in depth against a tampered config file rather
  // than untrusted input: a plaintext exchange would put the client secret and
  // the tokens on the wire.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(params.tokenUrl);
  } catch {
    console.error('[connectors:oauth2] connector token URL is not a URL');
    return { ok: false, reason: 'vendor_unreachable' };
  }
  if (parsedUrl.protocol !== 'https:') {
    console.error(
      `[connectors:oauth2] refusing a non-https token endpoint (${parsedUrl.protocol})`,
    );
    return { ok: false, reason: 'vendor_unreachable' };
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code_verifier: params.codeVerifier,
  });

  let response: Response;
  try {
    response = await fetchImpl(parsedUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
    });
  } catch (error) {
    // The message of a transport error is safe (no token was issued yet), but
    // keep it to one line and out of the user's response.
    console.error(
      '[connectors:oauth2] token endpoint unreachable:',
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, reason: 'vendor_unreachable' };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    console.error(
      `[connectors:oauth2] token endpoint returned a non-JSON body (status ${response.status})`,
    );
    return {
      ok: false,
      reason: response.ok ? 'malformed_response' : 'vendor_rejected',
    };
  }

  // Slack answers application errors with HTTP 200 and `ok: false`, so the
  // status alone never decides the outcome.
  const slackOk = isRecord(payload) ? payload.ok : undefined;
  if (!response.ok || slackOk === false) {
    return {
      ok: false,
      reason: 'vendor_rejected',
      code: vendorErrorCode(payload),
    };
  }

  if (!isRecord(payload)) {
    return { ok: false, reason: 'malformed_response' };
  }
  const accessToken = getString(payload, 'access_token');
  if (!accessToken) {
    return { ok: false, reason: 'malformed_response' };
  }

  const expiresIn = getNumber(payload, 'expires_in');
  const team = isRecord(payload.team) ? payload.team : undefined;

  return {
    ok: true,
    tokens: {
      accessToken,
      refreshToken: getString(payload, 'refresh_token'),
      expiresAt:
        expiresIn !== undefined && expiresIn > 0
          ? Date.now() + expiresIn * 1000
          : undefined,
      scopes: parseScopes(payload.scope),
      teamId: team ? getString(team, 'id') : undefined,
    },
  };
}
