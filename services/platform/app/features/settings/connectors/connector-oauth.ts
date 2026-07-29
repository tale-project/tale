import { getEnv } from '@/lib/env';

/**
 * The consent hand-off for connectors that authenticate through OAuth.
 *
 * The deployment owns the whole flow: its `/api/connectors/oauth2/start`
 * route re-checks that the signed-in member may add credentials, mints the
 * state token and PKCE pair, and redirects to the vendor; the callback
 * exchanges the code and stores the credential. So there is nothing to submit
 * from here and nothing to name — the page just hands the browser over, which
 * is also why re-consenting an existing credential uses the very same URL as a
 * first connection.
 *
 * A full-page navigation rather than a popup: the state lives server-side,
 * there is no opener to talk to, and nothing for a blocked popup to swallow.
 */

/** The deployment's OAuth start URL for one connector. */
function authorizationUrl(
  organizationId: string,
  connectorSlug: string,
): string {
  const siteUrl = getEnv('SITE_URL');
  const basePath = getEnv('BASE_PATH');
  const url = new URL(
    `${siteUrl}${basePath}/http_api/api/connectors/oauth2/start`,
  );
  url.searchParams.set('connector', connectorSlug);
  url.searchParams.set('organizationId', organizationId);
  return url.toString();
}

/** Leave the page for the vendor's consent screen. */
export function goToAuthorization(
  organizationId: string,
  connectorSlug: string,
): void {
  globalThis.location.assign(authorizationUrl(organizationId, connectorSlug));
}
