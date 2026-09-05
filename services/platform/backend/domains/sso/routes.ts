import { Hono } from 'hono';
import type { Sql } from 'postgres';

import { ssoAuthorizeHandler } from '../../core/enterprise_sso/login/authorize_handler.ts';
import { ssoCallbackHandler } from '../../core/enterprise_sso/login/callback_handler.ts';
import {
  buildSessionCookie,
  type FinishLogin,
  type FinishLoginArgs,
} from '../../core/enterprise_sso/login/finish_login.ts';
import { samlAcsHandler } from '../../core/enterprise_sso/saml/acs_handler.ts';
import { samlLoginHandler } from '../../core/enterprise_sso/saml/login_handler.ts';
import { samlMetadataHandler } from '../../core/enterprise_sso/saml/metadata_handler.ts';
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

/** The 0.5 finisher: session cookie + 302 to the dashboard. */
export const finishLoginPg: FinishLogin = async (_ctx, args: FinishLoginArgs) => {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET not configured');
  const cookie = await buildSessionCookie(
    args.sessionToken,
    args.frontendOrigin,
    secret,
  );
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
