/**
 * The origins a login flow may hand the browser back to.
 *
 * `/authorize` accepts a `redirect_uri` and signs it into the state;
 * `/callback` adopts that URI's origin for every redirect it answers with
 * (error bounces, the dashboard). The signature proves WE minted the state,
 * not that the URI points at us — the value is caller-chosen — so both doors
 * check its origin here before trusting it: the public SITE_URL and the
 * request's own origin (dev and tests, in both the `127.0.0.1` and
 * `localhost` spellings the authorize handler always normalised between).
 * That is every origin the login page ever passes
 * (`${SITE_URL}${BASE_PATH}/http_api/api/sso/callback`); anything else is an
 * open redirect off the trusted domain.
 */
export function allowedRedirectOrigin(
  redirectUri: unknown,
  requestUrl: string,
): string | undefined {
  if (typeof redirectUri !== 'string' || redirectUri === '') return undefined;
  let origin: string;
  try {
    origin = new URL(redirectUri).origin;
  } catch (error) {
    console.warn(
      '[SSO] Ignoring unparsable redirect_uri:',
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
  const allowed = new Set<string>();
  const siteUrl = process.env.SITE_URL;
  if (siteUrl) allowed.add(new URL(siteUrl).origin);
  const requestOrigin = new URL(requestUrl).origin;
  allowed.add(requestOrigin);
  allowed.add(requestOrigin.replace('127.0.0.1', 'localhost'));
  allowed.add(requestOrigin.replace('localhost', '127.0.0.1'));
  return allowed.has(origin) ? origin : undefined;
}
