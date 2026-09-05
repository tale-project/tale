import { readCookie } from './cookies';

/**
 * The browser binding of a sign-in flow (RFC 6749 §10.12, RFC 9700 §4.7).
 *
 * A signed state (OIDC) or an issued AuthnRequest ID (SAML) proves a login
 * completion answers a flow THIS DEPLOYMENT started — not that THIS BROWSER
 * started it. Without a binding, anyone with an account at the org's IdP can
 * start a flow, capture the IdP's redirect and hand that URL (or auto-submit
 * that POST) to a victim, whose browser is then signed in as the attacker
 * (login CSRF / session forcing).
 *
 * So the door that starts a flow sets a short-lived, HttpOnly cookie holding
 * a random nonce and carries `sha256(nonce)` inside the signed state
 * (OIDC) or the RelayState (SAML). The door that completes it reads the
 * cookie back and refuses when the hashes disagree. The nonce never leaves
 * the browser; the hash is public and useless without it.
 */

/**
 * One fixed name: two flows started in the same browser within the
 * Max-Age (a second tab, a retried click) overwrite each other's nonce, and
 * the older completion is refused as a mismatch. Keying the name by the
 * hash would need the hash at every clear site too — the completing doors
 * clear the cookie even when the state fails to parse and carries none —
 * so a login is simply restarted; the seamless lane has no caller today.
 */
const FLOW_COOKIE = 'sso_flow';
/** The login-page key a completion not started in this browser bounces with. */
export const SSO_FLOW_MISMATCH_KEY = 'sso.errors.flowMismatch';
/** A flow is complete within minutes; the OIDC state expires at ten. */
export const FLOW_COOKIE_MAX_AGE_S = 10 * 60;

/**
 * `__Host-` over HTTPS: the browser then refuses the cookie unless it is
 * Secure, Path=/ and Domain-less — so a sibling subdomain cannot plant one.
 * Prefixes are only honoured over HTTPS, hence the plain name on HTTP (dev).
 */
export function flowCookieName(frontendOrigin: string): string {
  return frontendOrigin.startsWith('https://')
    ? `__Host-${FLOW_COOKIE}`
    : FLOW_COOKIE;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** 32 random bytes, URL-safe. */
export function newFlowNonce(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** What the starting door embeds in the state / RelayState. */
export async function hashFlowNonce(nonce: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(nonce),
  );
  return base64Url(new Uint8Array(digest));
}

export interface FlowCookieOptions {
  /** The origin the browser is on — decides the `__Host-`/Secure shape. */
  frontendOrigin: string;
}

/**
 * The completing request is cross-site in every shape it takes: the IdP
 * redirects a top-level page to the OIDC callback, the IdP's page POSTs to
 * the SAML ACS, and the seamless flow runs the whole OIDC round inside an
 * iframe — where a `Lax` cookie is withheld once a cross-site hop initiated
 * the navigation (Firefox counts redirect hops too). So the cookie is
 * `SameSite=None`, which browsers accept only with `Secure`, i.e. over
 * HTTPS; over plain HTTP (dev) the attribute is left off and the browser's
 * own default applies — a browser that defaults to `Lax` (Chrome, past its
 * two-minute Lax+POST grace) withholds it on the cross-site SAML ACS POST,
 * so a dev http:// SAML login bouncing with `sso.errors.flowMismatch` is
 * this, not a broken IdP; HTTPS deployments are unaffected. `None` costs no
 * binding strength: the check is the
 * secret nonce, which only a response of ours ever hands a browser
 * (`__Host-` keeps a sibling subdomain from planting one).
 */
function cookieAttributes(
  pair: string,
  maxAge: number,
  opts: FlowCookieOptions,
): string {
  const https = opts.frontendOrigin.startsWith('https://');
  const parts = [pair, `Max-Age=${maxAge}`, 'Path=/', 'HttpOnly'];
  if (https) parts.push('SameSite=None', 'Secure');
  return parts.join('; ');
}

/** The Set-Cookie value that starts a flow. */
export function buildFlowCookie(
  nonce: string,
  opts: FlowCookieOptions,
): string {
  return cookieAttributes(
    `${flowCookieName(opts.frontendOrigin)}=${nonce}`,
    FLOW_COOKIE_MAX_AGE_S,
    opts,
  );
}

/** The Set-Cookie value that ends one — single use, whatever the verdict. */
export function clearFlowCookie(opts: FlowCookieOptions): string {
  return cookieAttributes(`${flowCookieName(opts.frontendOrigin)}=`, 0, opts);
}

/** Whether the request carries a flow cookie at all (to know what to clear). */
export function hasFlowCookie(
  cookieHeader: string | null | undefined,
  frontendOrigin: string,
): boolean {
  return readCookie(cookieHeader, flowCookieName(frontendOrigin)) !== undefined;
}

/**
 * Whether the request's flow cookie is the nonce `expectedHash` was minted
 * from. `false` for a missing cookie, a missing hash (a state minted before
 * the binding existed) or a mismatch — the caller refuses in every case.
 */
export async function flowCookieMatches(
  cookieHeader: string | null | undefined,
  expectedHash: unknown,
  frontendOrigin: string,
): Promise<boolean> {
  if (typeof expectedHash !== 'string' || expectedHash === '') return false;
  const nonce = readCookie(cookieHeader, flowCookieName(frontendOrigin));
  if (nonce === undefined || nonce === '') return false;
  return (await hashFlowNonce(nonce)) === expectedHash;
}
