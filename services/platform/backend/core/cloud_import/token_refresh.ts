/**
 * Pure OAuth2 refresh helpers for cloud-import grants — shared by the 0.4
 * `resolve_token` action and the 0.5 backend's token resolver. Plain
 * fetches against the vendor token endpoints, never a throw on a non-OK
 * answer. A failure says WHICH kind it is, because the caller's reaction
 * differs: a dead grant (`invalid_grant` — the refresh token was revoked,
 * expired, or the user must consent again) is only fixed by a new consent,
 * while a 429/5xx from the token endpoint is the vendor's problem and the
 * next attempt may well succeed. Reading every non-OK as "dead" used to turn
 * one vendor blip during an unattended cron sync into a needs-reauth state
 * only the user could clear.
 */

import { getNumber, getString, isRecord } from '../../../lib/utils/type-utils';
import { microsoftCloudImportOauthUrls } from './deployment_config';
import { getCloudImportProviderEndpoints } from './providers';

export interface RefreshedTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export type TokenRefreshResult =
  | { ok: true; tokens: RefreshedTokens }
  | {
      ok: false;
      /** `dead_grant`: a new consent is the only fix. `unavailable`: retry
       * later — a throttle, an outage, a malformed answer, or a client
       * (deployment) misconfiguration the user cannot fix by reconnecting. */
      kind: 'dead_grant' | 'unavailable';
      status: number;
      /** Operator-readable summary (HTTP status + OAuth error code/text). */
      detail: string;
    };

/** OAuth2 error codes (RFC 6749 §5.2 + OIDC) that mean the grant itself is
 * gone: the refresh token is revoked/expired, or the user must interact. */
const DEAD_GRANT_ERRORS = new Set([
  'invalid_grant',
  'interaction_required',
  'consent_required',
  'login_required',
]);

const DETAIL_MAX_CHARS = 300;

export function parseOAuthTokenResponse(data: unknown): RefreshedTokens | null {
  if (!isRecord(data)) return null;
  const accessToken = getString(data, 'access_token');
  if (accessToken === undefined) return null;
  const refreshToken = getString(data, 'refresh_token');
  const expiresIn = getNumber(data, 'expires_in');
  return {
    accessToken,
    ...(refreshToken !== undefined && { refreshToken }),
    ...(expiresIn !== undefined && {
      expiresAt: Date.now() + expiresIn * 1000,
    }),
  };
}

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn(
      '[cloud-import] token endpoint answered a non-JSON body:',
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

/** Classify a non-OK token-endpoint answer from its OAuth error body. */
export function classifyRefreshFailure(
  status: number,
  bodyText: string,
): Extract<TokenRefreshResult, { ok: false }> {
  const body = parseJsonBody(bodyText);
  const code = isRecord(body) ? getString(body, 'error') : undefined;
  const description = isRecord(body)
    ? getString(body, 'error_description')
    : undefined;
  const summary = [code, description].filter(Boolean).join(': ');
  const detail = `HTTP ${status}${summary ? ` ${summary}` : ''}`.slice(
    0,
    DETAIL_MAX_CHARS,
  );
  const dead =
    code !== undefined && (status === 400 || status === 401)
      ? DEAD_GRANT_ERRORS.has(code)
      : false;
  return {
    ok: false,
    kind: dead ? 'dead_grant' : 'unavailable',
    status,
    detail,
  };
}

async function postRefresh(
  tokenUrl: string,
  form: Record<string, string>,
): Promise<TokenRefreshResult> {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...form, grant_type: 'refresh_token' }),
  });
  if (!response.ok) {
    return classifyRefreshFailure(response.status, await response.text());
  }
  const tokens = parseOAuthTokenResponse(await response.json());
  if (tokens === null) {
    return {
      ok: false,
      kind: 'unavailable',
      status: response.status,
      detail: `HTTP ${response.status} without an access_token`,
    };
  }
  return { ok: true, tokens };
}

export async function refreshMicrosoftAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
}): Promise<TokenRefreshResult> {
  const { tokenUrl } = microsoftCloudImportOauthUrls(args.tenantId);
  return postRefresh(tokenUrl, {
    client_id: args.clientId,
    client_secret: args.clientSecret,
    refresh_token: args.refreshToken,
  });
}

export async function refreshGoogleAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<TokenRefreshResult> {
  const { tokenUrl } = getCloudImportProviderEndpoints('google-drive');
  return postRefresh(tokenUrl, {
    client_id: args.clientId,
    client_secret: args.clientSecret,
    refresh_token: args.refreshToken,
  });
}
