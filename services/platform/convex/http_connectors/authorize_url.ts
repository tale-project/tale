/**
 * Building the vendor's authorization URL.
 *
 * The endpoint and the scopes come from the connector file — nothing here
 * invents either. What this module adds is the parts of the protocol the
 * catalog cannot express: the fixed redirect URI, the opaque state, PKCE, and
 * the handful of vendor-specific parameters without which a grant comes back
 * unusable.
 *
 * PKCE (RFC 7636, S256) is sent to EVERY vendor. It is what makes an
 * intercepted authorization code worthless — the code can only be redeemed by
 * whoever holds the verifier, which never leaves this deployment — and RFC 9700
 * makes it the baseline for authorization-code flows. A vendor that does not
 * implement it ignores the two extra parameters, so there is no reason to
 * maintain a per-vendor opt-in list.
 */

/**
 * Vendor quirks that decide whether we get a REFRESH token at all. Keyed on the
 * parsed host of the connector's own authorize URL (parsed, not substring
 * matched, so a lookalike host in a tampered catalog cannot claim the branch).
 *
 *  - Google issues a refresh token only when the request asks for offline
 *    access AND forces the consent screen; without both, a reconnect returns an
 *    access token that expires in an hour and cannot be renewed.
 *  - Microsoft expresses the same thing as a scope, `offline_access`, and
 *    `prompt=select_account` keeps a user with several work accounts from
 *    silently reconnecting the wrong one.
 */
function applyVendorParams(
  authorizeHost: string,
  params: URLSearchParams,
  scopes: string[],
): void {
  if (authorizeHost === 'accounts.google.com') {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
    return;
  }
  if (authorizeHost === 'login.microsoftonline.com') {
    if (!scopes.includes('offline_access')) scopes.push('offline_access');
    params.set('prompt', 'select_account');
  }
}

export interface AuthorizeUrlParams {
  readonly authorizeUrl: string;
  readonly scopes: readonly string[];
  readonly clientId: string;
  /** Deployment-fixed callback; must equal the one sent at token exchange. */
  readonly redirectUri: string;
  /** Opaque single-use token minted by `oauth_state.ts`. */
  readonly state: string;
  /** base64url(SHA-256(verifier)) — the S256 PKCE challenge. */
  readonly codeChallenge: string;
}

/**
 * The absolute URL to redirect the browser to. Throws only when the connector's
 * `authorizeUrl` is not an https URL, which would mean a corrupted catalog —
 * an http authorize endpoint would put the request (and the user's session with
 * the vendor) on the wire in the clear.
 */
export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  const url = new URL(params.authorizeUrl);
  if (url.protocol !== 'https:') {
    throw new Error(
      `connector authorize URL must be https, got "${url.protocol}"`,
    );
  }

  const scopes = [...params.scopes];
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
  });
  applyVendorParams(url.host, query, scopes);
  if (scopes.length > 0) {
    // RFC 6749 §3.3: a space-delimited list. Vendors that document commas
    // (Slack) accept the standard form too.
    query.set('scope', scopes.join(' '));
  }

  // Assigning `search` replaces any query the catalog URL already carried,
  // which is what we want: no catalog-supplied parameter may override the
  // redirect URI, the state or the challenge.
  url.search = query.toString();
  return url.toString();
}
