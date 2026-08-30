import type { ActionCtx } from '../../_generated/server';
import { signCookieValue } from '../sign_cookie_value';

export const SESSION_COOKIE_NAME = 'better-auth.session_token';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

export interface FinishLoginArgs {
  sessionToken: string;
  /** The origin the browser is on — decides Secure/__Secure- cookie shape
   * and where the dashboard redirect points. */
  frontendOrigin: string;
}

/**
 * The login FINISH seam: turn a freshly-minted session token into the
 * response that logs the browser in (session cookie + dashboard redirect).
 *
 * Injected so the same protocol handlers (OIDC callback, SAML ACS) serve
 * both runtimes: the Convex deployment finishes through Better Auth's
 * component handler ({@link finishLoginWithConvexAuth}, the default), while
 * the 0.5 backend injects its own finisher (cookie only — its Better Auth
 * reads the session row directly, no JWT side-channel).
 */
export type FinishLogin = (
  ctx: ActionCtx,
  args: FinishLoginArgs,
) => Promise<Response>;

/** The signed session cookie header value for `frontendOrigin`. */
export async function buildSessionCookie(
  sessionToken: string,
  frontendOrigin: string,
  secret: string,
): Promise<string> {
  const signedToken = await signCookieValue(sessionToken, secret);
  const isHttps = frontendOrigin.startsWith('https://');
  const cookieName = isHttps
    ? `__Secure-${SESSION_COOKIE_NAME}`
    : SESSION_COOKIE_NAME;
  const cookieParts = [
    `${cookieName}=${signedToken}`,
    `Max-Age=${SESSION_MAX_AGE}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isHttps) cookieParts.push('Secure');
  return cookieParts.join('; ');
}
