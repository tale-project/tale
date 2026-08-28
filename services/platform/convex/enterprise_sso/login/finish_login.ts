import type { ActionCtx } from '../../_generated/server';
import { createAuth } from '../../auth';
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

/**
 * The Convex-deployment finisher: session cookie + a Better Auth
 * `get-session` warm-up whose Set-Cookie headers (the Convex JWT lane) ride
 * along, then a 302 to the dashboard — byte-for-byte the pre-seam tail of
 * the callback/ACS handlers.
 */
export const finishLoginWithConvexAuth: FinishLogin = async (ctx, args) => {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET not configured');
  }
  const sessionCookie = await buildSessionCookie(
    args.sessionToken,
    args.frontendOrigin,
    secret,
  );

  const auth = createAuth(ctx);
  const authResponse = await auth.handler(
    new Request(
      new URL('/api/auth/get-session', args.frontendOrigin).toString(),
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${args.sessionToken}`,
          'Content-Type': 'application/json',
        },
      },
    ),
  );

  const headers = new Headers();
  const basePath = process.env.BASE_PATH || '';
  headers.set('Location', `${args.frontendOrigin}${basePath}/dashboard`);
  headers.append('Set-Cookie', sessionCookie);
  authResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') headers.append('Set-Cookie', value);
  });

  return new Response(null, { status: 302, headers });
};
