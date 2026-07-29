/**
 * Deployment-level inputs to the integration HTTP routes: the public origin the
 * vendor redirects back to, and the OAuth app credentials the exchange
 * authenticates with.
 *
 * Two rules shape this module.
 *
 * The redirect target is FIXED BY THE DEPLOYMENT. It is derived from `SITE_URL`
 * (plus `BASE_PATH`) and never from a request parameter, a `Host` header, or
 * anything else a caller controls — an OAuth callback that can be pointed
 * elsewhere is an open redirect that leaks authorization codes. An unset
 * `SITE_URL` is refused rather than guessed from the request: guessing is what
 * makes `Host`-header injection work.
 *
 * App credentials live ONLY in environment variables. The connector file
 * declares the vendor's endpoints and scopes; the client id/secret identify
 * THIS deployment's registration with that vendor and are secret, so they are
 * never in the catalog, never in a table, and never logged. The naming is
 * mechanical — connector slug upper-cased with dashes as underscores — so a new
 * OAuth2 connector needs no code change to become configurable:
 *
 *   INTEGRATION_OAUTH_GOOGLE_DRIVE_CLIENT_ID
 *   INTEGRATION_OAUTH_GOOGLE_DRIVE_CLIENT_SECRET
 *
 * Slack's inbound endpoint additionally needs the app's signing secret, which
 * is what authenticates every event delivery:
 *
 *   INTEGRATION_SLACK_SIGNING_SECRET
 */

/** Path of the OAuth2 callback, as registered with every vendor. */
export const OAUTH_CALLBACK_PATH = '/api/integrations/oauth2/callback';

/** Env var carrying the Slack app's request-signing secret. */
export const SLACK_SIGNING_SECRET_ENV = 'INTEGRATION_SLACK_SIGNING_SECRET';

/** `<SITE_URL><BASE_PATH>`, trailing slash trimmed, or null when unconfigured. */
export function resolvePublicBaseUrl(): string | null {
  const siteUrl = (process.env.SITE_URL ?? '').trim().replace(/\/$/, '');
  if (!siteUrl) return null;
  const basePath = (process.env.BASE_PATH ?? '').replace(/\/$/, '');
  return `${siteUrl}${basePath}`;
}

/**
 * The absolute `redirect_uri` handed to the vendor and replayed at the token
 * exchange. Null when `SITE_URL` is unset — the caller refuses the flow, since
 * every alternative source for this value is attacker-influenceable.
 */
export function resolveOauthRedirectUri(): string | null {
  const base = resolvePublicBaseUrl();
  return base === null ? null : `${base}${OAUTH_CALLBACK_PATH}`;
}

/** Where the browser lands after a completed (or refused) connection attempt. */
export function resolveIntegrationSettingsUrl(
  organizationId: string,
): string | null {
  const base = resolvePublicBaseUrl();
  return base === null
    ? null
    : `${base}/dashboard/${encodeURIComponent(organizationId)}/settings/integrations`;
}

/** `INTEGRATION_OAUTH_<SLUG>_` prefix for one connector's app credentials. */
export function oauthAppEnvPrefix(connectorSlug: string): string {
  return `INTEGRATION_OAUTH_${connectorSlug.toUpperCase().replaceAll('-', '_')}_`;
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
