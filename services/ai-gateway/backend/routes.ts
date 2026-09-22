/**
 * The gateway's HTTP surface.
 *
 * One door, and it guards the tokens. `GET /api/tokens*` sits behind the API
 * key and returns nothing but credentials; the panel's routes carry no
 * credential of their own, because the panel has no login — whatever fronts
 * this service decides who reaches it. Keeping the key OFF the panel routes is
 * deliberate: a machine holding it still cannot add or remove an account.
 *
 * The token endpoints answer in the shape the retired cc-gateway used —
 * `{"tokens": [{ id, label, account_email, status, access_token, expires_at,
 * scopes }]}` — so a broker mapping written against that service reads this
 * one unchanged.
 */

import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

import {
  AccountError,
  type AccountService,
  type TokenHandout,
} from './accounts';
import { readApiKey } from './api-key';
import { secretsMatch } from './crypto';
import { describeProviders, type ProviderRegistry } from './providers/index';
import { isProviderId, PROVIDER_IDS } from './providers/types';

export interface ApiOptions {
  accounts: AccountService;
  providers: ProviderRegistry;
  apiKey: string;
}

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

/** The error envelope every failing route answers with. */
function fail(code: string, message: string) {
  return { error: { code, message } } as const;
}

/**
 * One handed-out credential, in cc-gateway's wire shape.
 *
 * snake_case and this exact field set are the contract: the platform's
 * subscription-broker credential maps `$.tokens[*].access_token` by default,
 * and every tool written against cc-gateway reads the same names. `id` is a
 * string here — this service has never had cc-gateway's integer row ids.
 */
function serializeToken(handout: TokenHandout) {
  return {
    id: handout.id,
    label: handout.label,
    account_email: handout.accountEmail,
    status: handout.status,
    access_token: handout.accessToken,
    expires_at: handout.expiresAt,
    scopes: handout.scopes,
  };
}

export function createApi(options: ApiOptions) {
  const { accounts, providers } = options;
  const api = new Hono().basePath('/api');

  // --- Panel routes --------------------------------------------------------

  api.get('/providers', (c) =>
    c.json({ providers: describeProviders(providers) }),
  );

  api.get('/accounts', async (c) =>
    c.json({ accounts: await accounts.list() }),
  );

  api.post('/accounts/authorize', async (c) => {
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

  api.post('/accounts/complete', async (c) => {
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

  api.get('/accounts/:id/command', async (c) => {
    const command = await accounts.cliCommand(c.req.param('id'));
    if (command === null) {
      return c.json(fail('unknown_account', 'No such account.'), 404);
    }
    return c.json({ command });
  });

  api.delete('/accounts/:id', async (c) => {
    const removed = await accounts.remove(c.req.param('id'));
    if (!removed) {
      return c.json(fail('unknown_account', 'No such account.'), 404);
    }
    return c.body(null, 204);
  });

  // --- The token endpoints -------------------------------------------------

  /**
   * The API-key gate, applied per route rather than as a wildcard middleware.
   * A `use('*')` on this app would also cover the panel's routes, which are
   * deliberately not the key's to open — and a guard that silently widens to
   * the other audience is exactly the kind of mistake this split prevents.
   */
  const requireApiKey = createMiddleware(async (c, next) => {
    const provided = readApiKey(c.req.raw.headers);
    if (!provided || !secretsMatch(provided, options.apiKey)) {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json(
        fail('invalid_api_key', 'Invalid or missing API key.'),
        401,
      );
    }
    await next();
    return undefined;
  });

  /**
   * The whole pool, both vendors at once.
   *
   * This is the one payload where a token's vendor cannot be read off the URL,
   * so it carries `provider` on top of cc-gateway's fields. A consumer that
   * wants one vendor should ask for that vendor instead.
   */
  api.get('/tokens', requireApiKey, async (c) =>
    c.json({
      tokens: (await accounts.handOutTokens()).map((handout) =>
        // `serializeToken` builds a fresh object per call, so naming the
        // vendor on it mutates nothing anyone else holds.
        Object.assign(serializeToken(handout), { provider: handout.provider }),
      ),
    }),
  );

  /**
   * One vendor's tokens: `/api/tokens/anthropic`, `/api/tokens/openai`.
   *
   * Separate endpoints because a caller almost always wants one vendor — a
   * broker credential is attached to one provider, and handing it the other's
   * tokens would have it authenticate against the wrong API.
   */
  api.get('/tokens/:provider', requireApiKey, async (c) => {
    const provider = c.req.param('provider');
    if (!isProviderId(provider)) {
      return c.json(
        fail(
          'unknown_provider',
          `No such provider. This gateway holds ${PROVIDER_IDS.join(' and ')}.`,
        ),
        404,
      );
    }
    const tokens = await accounts.handOutTokens(provider);
    return c.json({ tokens: tokens.map(serializeToken) });
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
