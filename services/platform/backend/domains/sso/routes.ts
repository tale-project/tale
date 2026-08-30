import { Hono } from 'hono';
import type { Sql } from 'postgres';

import { ssoAuthorizeHandler } from '../../../convex/enterprise_sso/login/authorize_handler.ts';
import { ssoCallbackHandler } from '../../../convex/enterprise_sso/login/callback_handler.ts';
import { ssoDiscoverHandler } from '../../../convex/enterprise_sso/login/discover_handler.ts';
import type {
  FinishLogin,
  FinishLoginArgs,
} from '../../../convex/enterprise_sso/login/finish_login.ts';
import { samlAcsHandler } from '../../../convex/enterprise_sso/saml/acs_handler.ts';
import { samlLoginHandler } from '../../../convex/enterprise_sso/saml/login_handler.ts';
import { samlMetadataHandler } from '../../../convex/enterprise_sso/saml/metadata_handler.ts';
import { signCookieValue } from '../../../convex/enterprise_sso/sign_cookie_value.ts';
import { createCtxShim } from '../../lib/convex-shim.ts';
import { ssoShimHandlers } from './shim.ts';

/**
 * /api/sso — enterprise sign-in, the REUSED 0.4 protocol handlers whole
 * (OIDC discover/authorize/callback, SAML metadata/login/ACS) on the SSO
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function createSsoRoutes(deps: { sql: Sql }): Hono {
  const app = new Hono();
  const shim = () => {
    const ctx = createCtxShim(ssoShimHandlers(deps.sql));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 handlers; every ctx facility they touch is covered by ssoShimHandlers
    return ctx as unknown as Parameters<typeof ssoDiscoverHandler>[0];
  };

  app.post('/discover', async (c) => ssoDiscoverHandler(shim(), c.req.raw));

  app.get('/authorize', async (c) => ssoAuthorizeHandler(shim(), c.req.raw));

  app.get('/callback', async (c) =>
    ssoCallbackHandler(shim(), c.req.raw, { finishLogin: finishLoginPg }),
  );

  /**
   * GET /set-session — the token→cookie interstitial (desktop/cross-origin
   * flows hand the browser here). The 0.5 twin of `set_session_handler`:
   * sign the cookie, answer an HTML page that redirects to the dashboard
   * (HTML rather than 302 so Set-Cookie is reliably applied).
   */
  app.get('/set-session', async (c) => {
    const token = c.req.query('token');
    const frontendOrigin = new URL(c.req.url).origin;
    const basePath = process.env.BASE_PATH || '';
    if (!token) {
      const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Login Error</title></head>
<body>
  <p>Error: ${escapeHtml('Missing session token')}</p>
  <p><a href="${basePath}/log-in">Return to login</a></p>
</body>
</html>`;
      return c.html(html);
    }
    const cookie = await sessionCookieFor(token, frontendOrigin);
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${basePath}/dashboard">
  <title>Completing login...</title>
</head>
<body>
  <p>Completing login, please wait...</p>
  <script>window.location.href = '${basePath}/dashboard';</script>
</body>
</html>`;
    c.header('Set-Cookie', cookie);
    return c.html(html);
  });

  app.get('/saml/metadata', async (c) =>
    samlMetadataHandler(shim(), c.req.raw),
  );
  app.get('/saml/login', async (c) => samlLoginHandler(shim(), c.req.raw));
  app.post('/saml/acs', async (c) =>
    samlAcsHandler(shim(), c.req.raw, { finishLogin: finishLoginPg }),
  );

  return app;
}
