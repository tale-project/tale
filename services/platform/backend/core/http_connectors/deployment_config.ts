/**
 * Deployment-level inputs to the connector HTTP routes: the public origin the
 * vendor redirects back to, and the OAuth app credentials the exchange
 * authenticates with.
 *
 * Two rules shape this module.
 *
 * The redirect target is FIXED BY THE DEPLOYMENT. It is one of the configured
 * site origins — `SITE_URL` or an `ADDITIONAL_SITE_URLS` entry — plus
 * `BASE_PATH`, and never a request parameter, a raw `Host` header, or anything
 * else a caller controls: an OAuth callback that can be pointed elsewhere is an
 * open redirect that leaks authorization codes. On a multi-domain deployment
 * the door picks the configured origin the browser is on (its session cookie
 * lives there, and the callback must land where the session is), so the
 * request decides WHICH of the deployment's own origins — never a new one. An
 * unset `SITE_URL` is refused rather than guessed from the request: guessing
 * is what makes `Host`-header injection work.
 *
 * App credentials live ONLY in environment variables. The connector file
 * declares the vendor's endpoints and scopes; the client id/secret identify
 * THIS deployment's registration with that vendor and are secret, so they are
 * never in the catalog, never in a table, and never logged. The naming is
 * mechanical — connector slug upper-cased with dashes as underscores — so a new
 * OAuth2 connector needs no code change to become configurable:
 *
 *   CONNECTOR_OAUTH_GOOGLE_DRIVE_CLIENT_ID
 *   CONNECTOR_OAUTH_GOOGLE_DRIVE_CLIENT_SECRET
 *
 * Slack's inbound endpoint additionally needs the app's signing secret, which
 * is what authenticates every event delivery:
 *
 *   CONNECTOR_SLACK_SIGNING_SECRET
 */

import {
  canonicalOrigin,
  publicBaseUrlFor,
  siteOrigins,
} from '../lib/helpers/public_origin';

/** Path of the OAuth2 callback, as registered with every vendor. */
export const OAUTH_CALLBACK_PATH = '/api/connectors/oauth2/callback';

/** Env var carrying the Slack app's request-signing secret. */
export const SLACK_SIGNING_SECRET_ENV = 'CONNECTOR_SLACK_SIGNING_SECRET';

/**
 * `<origin><BASE_PATH>`, or null when `SITE_URL` is unconfigured. `origin`
 * is the public origin the browser is on (`publicOrigin(req)`); it is used
 * only when it is one of the configured site origins, otherwise — and when
 * omitted — the canonical `SITE_URL` origin stands.
 */
export function resolvePublicBaseUrl(origin?: string | null): string | null {
  const canonical = canonicalOrigin();
  if (canonical === null) return null;
  const chosen =
    origin !== undefined && origin !== null && siteOrigins().includes(origin)
      ? origin
      : canonical;
  return publicBaseUrlFor(chosen);
}

/**
 * The absolute `redirect_uri` handed to the vendor and replayed at the token
 * exchange, on the browser's own site origin. Null when `SITE_URL` is unset —
 * the caller refuses the flow, since every alternative source for this value
 * is attacker-influenceable.
 */
export function resolveOauthRedirectUri(origin?: string | null): string | null {
  const base = resolvePublicBaseUrl(origin);
  return base === null ? null : `${base}${OAUTH_CALLBACK_PATH}`;
}

/**
 * The `<origin><BASE_PATH>` a redirect URI we minted was built on — the
 * start door's site origin, recovered from the state row at callback time so
 * the browser returns to the domain it started on.
 */
export function publicBaseFromRedirectUri(redirectUri: string): string | null {
  if (!redirectUri.endsWith(OAUTH_CALLBACK_PATH)) return null;
  return redirectUri.slice(0, -OAUTH_CALLBACK_PATH.length);
}

/**
 * Where the browser lands after a completed (or refused) connection attempt.
 * `base` is the `<origin><BASE_PATH>` of the flow (from its redirect URI or
 * the request's public origin); omitted, the canonical one.
 */
export function resolveConnectorSettingsUrl(
  organizationId: string,
  base: string | null = resolvePublicBaseUrl(),
): string | null {
  return base === null
    ? null
    : `${base}/dashboard/${encodeURIComponent(organizationId)}/settings/connectors`;
}

/** `CONNECTOR_OAUTH_<SLUG>_` prefix for one connector's app credentials. */
export function oauthAppEnvPrefix(connectorSlug: string): string {
  return `CONNECTOR_OAUTH_${connectorSlug.toUpperCase().replaceAll('-', '_')}_`;
}

export interface OauthAppCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * This deployment's registration with the connector's vendor, or null when the
 * operator has not configured one. Callers report the MISSING VARIABLE NAMES to
 * the server log and show the user a generic "not configured" page — the names
 * are not secret, but the values must never reach a response or a log line.
 */
export function resolveOauthAppCredentials(
  connectorSlug: string,
): OauthAppCredentials | null {
  const prefix = oauthAppEnvPrefix(connectorSlug);
  const clientId = (process.env[`${prefix}CLIENT_ID`] ?? '').trim();
  const clientSecret = (process.env[`${prefix}CLIENT_SECRET`] ?? '').trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** The Slack app's signing secret, or null when unconfigured. */
export function resolveSlackSigningSecret(): string | null {
  const secret = (process.env[SLACK_SIGNING_SECRET_ENV] ?? '').trim();
  return secret.length > 0 ? secret : null;
}
