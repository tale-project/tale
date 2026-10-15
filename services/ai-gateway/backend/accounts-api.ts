/**
 * The machine door to the pool: read the accounts, and change them.
 *
 * The panel's own routes carry no credential, because whatever fronts the
 * gateway decides who reaches the panel. A script has no such front door, so
 * everything here asks for a key — and asks for two kinds:
 *
 * - **Reading** takes the same key that opens the token endpoints, or the
 *   admin key. An account's figures are a subset of what that key already
 *   reads from `/api/tokens`, so this widens nothing.
 * - **Changing** — starting an authorization, completing one, removing an
 *   account — takes the admin key only, and is off while the gateway has none.
 *   Adding an account puts someone else's subscription into the pool the
 *   platform draws from, which is not something every holder of a token key
 *   should be able to do. An operator who wants one key sets both variables to
 *   the same value.
 *
 * Guards are attached per route, never as a wildcard, for the reason
 * `routes.ts` gives: a guard that silently widens to another audience is the
 * mistake this split exists to prevent.
 *
 * Names are snake_case, as on the token endpoints, so the same concept has the
 * same field wherever a script meets it.
 */

import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

import { ACCOUNT_STATES, type AccountState } from './account-state';
import type { AccountService, AuthorizationStart } from './accounts';
import { readApiKey } from './api-key';
import { secretsMatch } from './crypto';
import { fail } from './envelope';
import { isProviderId, PROVIDER_IDS } from './providers/types';
import type { AccountView } from './store';

export interface AccountsApiOptions {
  accounts: AccountService;
  /** The key of the token endpoints: reads. */
  apiKey: string;
  /** The admin key: reads and changes. Null while changing is switched off. */
  adminApiKey: string | null;
}

const startSchema = z.object({
  provider: z.string().refine(isProviderId, 'Unknown provider'),
  /** Set to re-authenticate an existing account instead of adding one. */
  account_id: z.string().min(1).nullish(),
  /** A name for the account; a flow that finishes on its own still has it. */
  label: z.string().max(200).nullish(),
  /** `browser`: the paste flow, even where a device flow is offered. */
  method: z.literal('browser').nullish(),
});

const completeSchema = z.object({
  /** Whatever the person copied out of the browser. */
  pasted: z.string().min(1),
});

/** One account as a script sees it: no credential, in the token door's names. */
function serializeAccount(view: AccountView) {
  return {
    id: view.id,
    provider: view.provider,
    label: view.label,
    account_email: view.accountEmail,
    subscription: view.subscription,
    status: view.status,
    state: view.state,
    limited_until: view.limitedUntil,
    expires_at: view.expiresAt,
    scopes: view.scopes,
    created_at: view.createdAt,
    last_refreshed_at: view.lastRefreshedAt,
    usage: view.usage
      ? {
          checked_at: view.usage.checkedAt,
          stale: view.usage.stale,
          limited: view.usage.limited,
          windows: view.usage.windows.map((window) => ({
            kind: window.kind,
            label: window.label,
            utilization: window.utilization,
            resets_at: window.resetsAt,
            window_seconds: window.windowSeconds,
            blocking: window.blocking,
          })),
        }
      : null,
  };
}

/**
 * A started authorization, as a script is told to finish it. A device flow
 * finishes on its own once the code is approved; a paste flow waits for
 * `POST …/complete`. A redirect flow never reaches here — it needs a browser
 * on a loopback address, and this door passes none — but the union is
 * answered whole rather than assumed.
 */
function serializeStart(start: AuthorizationStart) {
  if (start.flow === 'device') {
    return {
      state: start.state,
      flow: start.flow,
      verification_url: start.verificationUrl,
      user_code: start.userCode,
      expires_at: start.expiresAt,
      poll_interval_seconds: start.pollIntervalSeconds,
    };
  }
  if (start.flow === 'redirect') {
    return {
      state: start.state,
      flow: start.flow,
      authorize_url: start.authorizeUrl,
    };
  }
  return {
    state: start.state,
    flow: start.flow,
    authorize_url: start.authorizeUrl,
    paste_style: start.pasteStyle,
  };
}

export function createAccountsApi(options: AccountsApiOptions) {
  const { accounts } = options;
  const app = new Hono();

  /**
   * Who is asking, and whether that is enough.
   *
   * Both keys are always compared, so how long the answer takes does not say
   * which of them was close. A key that is right but not enough is a 403, not
   * a 401: the caller is known, and trying another key of the same kind
   * cannot help.
   */
  function guard(access: 'read' | 'control') {
    return createMiddleware(async (c, next) => {
      c.header('Cache-Control', 'no-store');
      const provided = readApiKey(c.req.raw.headers);
      const isToken =
        provided !== null && secretsMatch(provided, options.apiKey);
      const isAdmin =
        provided !== null &&
        options.adminApiKey !== null &&
        secretsMatch(provided, options.adminApiKey);
      if (!isToken && !isAdmin) {
        c.header('WWW-Authenticate', 'Bearer');
        return c.json(
          fail('invalid_api_key', 'Invalid or missing API key.'),
          401,
        );
      }
      if (access === 'control' && !isAdmin) {
        return options.adminApiKey === null
          ? c.json(
              fail(
                'control_disabled',
                'This gateway has no admin key, so accounts cannot be changed over the API.',
              ),
              403,
            )
          : c.json(
              fail(
                'admin_key_required',
                'This key can read accounts but not change them.',
              ),
              403,
            );
      }
      await next();
      return undefined;
    });
  }

  const read = guard('read');
  const control = guard('control');

  // --- Reading --------------------------------------------------------------

  /**
   * The pool, without a credential in it. Narrowed by `?provider=` and
   * `?state=` — a script that only wants the limited Claude accounts should
   * not have to filter the whole pool itself.
   */
  app.get('/accounts', read, async (c) => {
    const provider = c.req.query('provider');
    const state = c.req.query('state');
    if (provider !== undefined && !isProviderId(provider)) {
      return c.json(
        fail(
          'invalid_request',
          `No such provider. This gateway holds ${PROVIDER_IDS.join(' and ')}.`,
        ),
        400,
      );
    }
    if (state !== undefined && !isAccountState(state)) {
      return c.json(
        fail(
          'invalid_request',
          `No such state. Use ${ACCOUNT_STATES.join(', ')}.`,
        ),
        400,
      );
    }
    const views = await accounts.list();
    return c.json({
      accounts: views
        .filter(
          (view) =>
            (provider === undefined || view.provider === provider) &&
            (state === undefined || view.state === state),
        )
        .map(serializeAccount),
    });
  });

  app.get('/accounts/:id', read, async (c) => {
    const view = await accounts.get(c.req.param('id'));
    if (!view) return c.json(fail('unknown_account', 'No such account.'), 404);
    return c.json({ account: serializeAccount(view) });
  });

  // --- Changing -------------------------------------------------------------

  /**
   * Start an authorization. Always the flow that needs no browser on this
   * machine's loopback — a device code, or a paste — because a script has no
   * `Origin` to be trusted with a redirect, and the body cannot ask for one.
   */
  app.post('/authorizations', control, async (c) => {
    const body = startSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json(
        fail(
          'invalid_request',
          `Name a provider: ${PROVIDER_IDS.join(' or ')}.`,
        ),
        400,
      );
    }
    const start = await accounts.beginAuthorization({
      provider: body.data.provider,
      accountId: body.data.account_id ?? null,
      label: body.data.label ?? null,
      loopbackOrigin: null,
      preferBrowser: body.data.method === 'browser',
    });
    audit(
      body.data.account_id
        ? `started signing account ${body.data.account_id} in again`
        : `started adding an account for ${body.data.provider}`,
    );
    return c.json({ authorization: serializeStart(start) }, 201);
  });

  /**
   * Where an authorization stands. For a device code this is also what moves
   * it on — a read may ask the vendor whether it was approved — so a script
   * polls it, no faster than the interval the start named.
   */
  app.get('/authorizations/:state', control, async (c) => {
    const state = c.req.param('state');
    const status = await accounts.authorizationStatus(state);
    if (status.status === 'connected') {
      // A device code connects its account in a read like this one — the only
      // moment this door learns it did — so that read is where it is noted. A
      // script that reads on after the connection leaves a line each time.
      audit(`connected account ${status.account.id}`);
      return c.json({
        authorization: {
          state,
          status: status.status,
          account: serializeAccount(status.account),
        },
      });
    }
    return c.json({
      authorization: {
        state,
        status: status.status,
        ...(status.status === 'failed' ? { code: status.code } : {}),
      },
    });
  });

  app.post('/authorizations/:state/complete', control, async (c) => {
    const body = completeSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json(
        fail('invalid_request', 'Send what the browser gave back as `pasted`.'),
        400,
      );
    }
    const account = await accounts.completeAuthorization({
      state: c.req.param('state'),
      pasted: body.data.pasted,
    });
    audit(`connected account ${account.id}`);
    return c.json({ account: serializeAccount(account) }, 201);
  });

  app.delete('/accounts/:id', control, async (c) => {
    const id = c.req.param('id');
    const removed = await accounts.remove(id);
    if (!removed) {
      return c.json(fail('unknown_account', 'No such account.'), 404);
    }
    audit(`removed account ${id}`);
    return c.body(null, 204);
  });

  return app;
}

/**
 * Every change made over this door leaves a line: the one trail a way to
 * change the pool owes whoever runs the gateway, and the only one the admin key
 * gives, since a key names no person. Only what the gateway itself vouches
 * for — an account's id, after the change found it; a vendor's id — never a
 * label, an address or anything a credential is made of, and never text the
 * caller wrote, which a newline could turn into a line of its own.
 */
function audit(message: string): void {
  console.info(`[ai-gateway] accounts API: ${message}`);
}

function isAccountState(value: string): value is AccountState {
  return (ACCOUNT_STATES as readonly string[]).includes(value);
}
