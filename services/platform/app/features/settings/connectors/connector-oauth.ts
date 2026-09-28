import { getEnv } from '@/lib/env';
import {
  RECONNECT_CREDENTIAL_PARAM,
  type ConsentIntent,
} from '@/lib/shared/connector-consent';

/**
 * The consent hand-off for connectors that authenticate through OAuth.
 *
 * The deployment owns the whole flow: its `/api/connectors/oauth2/start`
 * route re-checks that the signed-in member may add credentials, mints the
 * state token and PKCE pair, and redirects to the vendor; the callback
 * exchanges the code and stores the credential. So there is nothing to submit
 * from here and nothing to name — the page just hands the browser over, and
 * says what the consent is FOR. An Add stores a new credential; a Reconnect
 * names the credential it renews, which the server checks, keeps on the
 * pending authorization, and writes to exactly — never to the connector's
 * default instead.
 *
 * A full-page navigation rather than a popup: the state lives server-side,
 * there is no opener to talk to, and nothing for a blocked popup to swallow.
 */

/** The deployment's OAuth start URL for one connector and intent. */
export function authorizationUrl(
  organizationId: string,
  connectorSlug: string,
  intent: ConsentIntent,
): string {
  const siteUrl = getEnv('SITE_URL');
  const basePath = getEnv('BASE_PATH');
  const url = new URL(`${siteUrl}${basePath}/api/connectors/oauth2/start`);
  url.searchParams.set('connector', connectorSlug);
  url.searchParams.set('organizationId', organizationId);
  if (intent.kind === 'reconnect') {
    url.searchParams.set(RECONNECT_CREDENTIAL_PARAM, intent.credentialId);
  }
  return url.toString();
}

/** Leave the page for the vendor's consent screen. */
export function goToAuthorization(
  organizationId: string,
  connectorSlug: string,
  intent: ConsentIntent,
): void {
  globalThis.location.assign(
    authorizationUrl(organizationId, connectorSlug, intent),
  );
}
