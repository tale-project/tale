/**
 * The gateway's HTTP surface.
 *
 * Two audiences, two doors. The panel's routes sit behind the session cookie
 * a password mints and never return a token; `GET /api/tokens` sits behind
 * the API key and returns nothing but tokens. Keeping them apart is why a
 * leaked browser session cannot exfiltrate the pool and why a machine holding
 * the API key cannot add or remove accounts.
 */

import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

import { AccountError, type AccountService } from './accounts';
import { secretsMatch } from './crypto';
import { describeProviders, type ProviderRegistry } from './providers/index';
import { isProviderId } from './providers/types';
import {
  readApiKey,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  type SessionSigner,
} from './session';

export interface ApiOptions {
  accounts: AccountService;
  providers: ProviderRegistry;
  session: SessionSigner;
  panelPassword: string;
  apiKey: string;
}

const loginSchema = z.object({ password: z.string().min(1) });

const authorizeSchema = z.object({
  provider: z.string().refine(isProviderId, 'Unknown provider'),
  /** Set to re-authenticate an existing account instead of adding one. */
  accountId: z.string().min(1).nullish(),
});

const completeSchema = z.object({
  state: z.string().min(1),
  /** Whatever the person copied out of the browser. */
  pasted: z.string().min(1),
  label: z.string().nullish(),
});

/**
 * Whether this request arrived over TLS.
 *
 * The session cookie is marked `Secure` only then. Deciding per request rather
 * than per deployment is what keeps a plain-HTTP run — the dev server, a
 * gateway on `localhost:3004`, a first boot before a certificate exists —
 * able to sign in at all: a `Secure` cookie on `http://` is set and never
 * sent back, which reads as "the password silently does nothing".
 */
function isSecureRequest(request: Request): boolean {
  if (request.headers.get('x-forwarded-proto') === 'https') return true;
  return new URL(request.url).protocol === 'https:';
}

/** The error envelope every failing route answers with. */
function fail(code: string, message: string) {
  return { error: { code, message } } as const;
}

export function createApi(options: ApiOptions) {
  const { accounts, providers, session } = options;
  const api = new Hono().basePath('/api');

  // --- The panel session ---------------------------------------------------

  function isSignedIn(cookieHeader: string | undefined): boolean {
    return session.verify(cookieHeader);
  }

  api.get('/session', (c) =>
    c.json({ authenticated: isSignedIn(getCookie(c, SESSION_COOKIE_NAME)) }),
  );

  api.post('/session', async (c) => {
    const body = loginSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json(fail('invalid_request', 'A password is required.'), 400);
    }
    if (!secretsMatch(body.data.password, options.panelPassword)) {
      return c.json(fail('invalid_password', 'That password is wrong.'), 401);
    }
    setCookie(c, SESSION_COOKIE_NAME, session.issue(), {
      httpOnly: true,
      sameSite: 'Strict',
      secure: isSecureRequest(c.req.raw),
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
    return c.body(null, 204);
  });

  api.delete('/session', (c) => {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
    return c.body(null, 204);
  });

  // --- Panel routes --------------------------------------------------------

  /**
   * The session gate, applied per route rather than as a wildcard middleware.
   * A `use('*')` on this app would also cover `/api/tokens`, whose door is the
   * API key — and a guard that silently widens to the other audience is
   * exactly the kind of mistake this split exists to prevent.
   */
  const requireSession = createMiddleware(async (c, next) => {
    if (!isSignedIn(getCookie(c, SESSION_COOKIE_NAME))) {
      return c.json(fail('not_signed_in', 'Sign in to the panel first.'), 401);
    }
    await next();
    return undefined;
  });

  api.get('/providers', requireSession, (c) =>
    c.json({ providers: describeProviders(providers) }),
  );

  api.get('/accounts', requireSession, async (c) =>
    c.json({ accounts: await accounts.list() }),
  );

  api.post('/accounts/authorize', requireSession, async (c) => {
    const body = authorizeSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(fail('invalid_request', 'Name a known provider.'), 400);
    }
    return c.json(
      await accounts.beginAuthorization({
        provider: body.data.provider,
        accountId: body.data.accountId ?? null,
      }),
    );
  });

  api.post('/accounts/complete', requireSession, async (c) => {
    const body = completeSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json(
        fail('invalid_request', 'Paste what the browser gave you.'),
        400,
      );
    }
    const account = await accounts.completeAuthorization({
      state: body.data.state,
      pasted: body.data.pasted,
      label: body.data.label ?? null,
    });
    return c.json({ account }, 201);
  });

  api.get('/accounts/:id/command', requireSession, async (c) => {
    const command = await accounts.cliCommand(c.req.param('id'));
    if (command === null) {
      return c.json(fail('unknown_account', 'No such account.'), 404);
    }
    return c.json({ command });
  });

  api.delete('/accounts/:id', requireSession, async (c) => {
    const removed = await accounts.remove(c.req.param('id'));
    if (!removed) {
      return c.json(fail('unknown_account', 'No such account.'), 404);
    }
    return c.body(null, 204);
  });

  // --- The token endpoint --------------------------------------------------

  api.get('/tokens', async (c) => {
    const provided = readApiKey(c.req.raw.headers);
    if (!provided || !secretsMatch(provided, options.apiKey)) {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json(
        fail('invalid_api_key', 'Invalid or missing API key.'),
        401,
      );
    }
    return c.json({ tokens: await accounts.handOutTokens() });
  });

  // --- Failures ------------------------------------------------------------

  api.onError((error, c) => {
    if (error instanceof AccountError) {
      const status = error.code === 'unknown_account' ? 404 : 400;
      return c.json(fail(error.code, error.message), status);
    }
    console.error('[ai-gateway] request failed:', error);
    return c.json(fail('internal_error', 'Something went wrong.'), 500);
  });

  return api;
}

export type Api = ReturnType<typeof createApi>;

/**
 * Bridge the API into a host that owns the rest of the request pipeline.
 *
 * Returns `null` for anything the gateway does not serve so the caller falls
 * through — `/api/health` belongs to the shared React server, and every other
 * path is the SPA's.
 */
export function createApiDispatcher(api: Api) {
  return function dispatch(
    request: Request,
    url: URL,
  ): Promise<Response> | null {
    if (!url.pathname.startsWith('/api/')) return null;
    if (url.pathname === '/api/health') return null;
    return Promise.resolve(api.fetch(request));
  };
}
