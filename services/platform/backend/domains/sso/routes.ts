import { Hono } from 'hono';
import type { Sql } from 'postgres';

import { ssoAuthorizeHandler } from '../../core/enterprise_sso/login/authorize_handler.ts';
import { ssoCallbackHandler } from '../../core/enterprise_sso/login/callback_handler.ts';
import type {
  FinishLogin,
  FinishLoginArgs,
} from '../../core/enterprise_sso/login/finish_login.ts';
import { samlAcsHandler } from '../../core/enterprise_sso/saml/acs_handler.ts';
import { samlLoginHandler } from '../../core/enterprise_sso/saml/login_handler.ts';
import { samlMetadataHandler } from '../../core/enterprise_sso/saml/metadata_handler.ts';
import { signCookieValue } from '../../core/enterprise_sso/sign_cookie_value.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { ssoShimHandlers } from './shim.ts';

/**
 * /api/sso — enterprise sign-in, the REUSED 0.4 protocol handlers whole
 * (OIDC authorize/callback, SAML metadata/login/ACS) on the SSO
 * shim. The one injected difference is the login FINISH: 0.4 warmed up the
 * Convex JWT lane after setting the session cookie; 0.5's Better Auth reads
 * the session row directly, so the finisher just signs the cookie and
 * redirects (the seam both handlers take as `deps.finishLogin`).
 */

const SESSION_COOKIE_NAME = 'better-auth.session_token';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

async function sessionCookieFor(
  sessionToken: string,
  frontendOrigin: string,
): Promise<string> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET not configured');
  const signedToken = await signCookieValue(sessionToken, secret);
  const isHttps = frontendOrigin.startsWith('https://');
  const cookieName = isHttps
    ? `__Secure-${SESSION_COOKIE_NAME}`
    : SESSION_COOKIE_NAME;
  const parts = [
    `${cookieName}=${signedToken}`,
    `Max-Age=${SESSION_MAX_AGE}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

/** The 0.5 finisher: session cookie + 302 to the dashboard. */
const finishLoginPg: FinishLogin = async (_ctx, args: FinishLoginArgs) => {
  const cookie = await sessionCookieFor(args.sessionToken, args.frontendOrigin);
  const basePath = process.env.BASE_PATH || '';
  const headers = new Headers();
  headers.set('Location', `${args.frontendOrigin}${basePath}/dashboard`);
  headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
};

export function createSsoRoutes(deps: { sql: Sql }): Hono {
  const app = new Hono();
  const shim = () => {
    const ctx = createCtxShim(ssoShimHandlers(deps.sql));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 handlers; every ctx facility they touch is covered by ssoShimHandlers
    return ctx as unknown as Parameters<typeof ssoAuthorizeHandler>[0];
  };

  app.get('/authorize', async (c) => ssoAuthorizeHandler(shim(), c.req.raw));

  app.get('/callback', async (c) =>
    ssoCallbackHandler(shim(), c.req.raw, { finishLogin: finishLoginPg }),
  );

  app.get('/saml/metadata', async (c) =>
    samlMetadataHandler(shim(), c.req.raw),
  );
  app.get('/saml/login', async (c) => samlLoginHandler(shim(), c.req.raw));
  app.post('/saml/acs', async (c) =>
    samlAcsHandler(shim(), c.req.raw, { finishLogin: finishLoginPg }),
  );

  return app;
}
