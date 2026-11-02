// The HTTP side of the backend: the security checks, the `/api` routes and the
// door to `/mcp`. `createApp(...).fetch` is what the server calls for `/api/*`
// and `/mcp`; the page itself is served elsewhere.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { ZodError } from 'zod';
import type { z } from 'zod';

import type { Config } from './config.ts';
import { createMetaRoutes } from './domains/meta/routes.ts';
import { createProxyRoutes } from './domains/proxies/routes.ts';
import { createSecretRoutes } from './domains/secrets/routes.ts';
import type { Manager } from './domains/sessions/manager.ts';
import { createSessionRoutes } from './domains/sessions/routes.ts';
import { createSettingsRoutes } from './domains/settings/routes.ts';
import { AppError } from './errors.ts';
import { localOnly } from './security.ts';

export interface AppDeps {
  manager: Manager;
  config: Pick<Config, 'allowedHosts'>;
  /** Answers `/mcp` (any method). Without it `/mcp` is a 404. */
  mcp?: (request: Request) => Response | Promise<Response>;
}

/** The most issues a refusal lists: enough to fix a request, never a hostile body at length. */
const MAX_ISSUES = 20;

const NOTHING_HERE = 'There is nothing at this address.';

interface Issue {
  path: Array<string | number>;
  message: string;
  code: string;
}

/**
 * A field that was not sent "is required". Zod words it as a type mismatch
 * with `undefined`, which says less to the person reading the 422.
 */
function reasonOf(issue: z.core.$ZodIssue): string {
  return issue.code === 'invalid_type' &&
    issue.message.endsWith('received undefined')
    ? 'Field required'
    : issue.message;
}

/**
 * The 422 body for a request that failed its schema. It lists where and why,
 * never the value: a rejected value could be a proxy with a password in it.
 */
function validationBody(error: ZodError) {
  const issues: Issue[] = error.issues.slice(0, MAX_ISSUES).map((issue) => ({
    path: issue.path.map((part) =>
      typeof part === 'number' ? part : String(part),
    ),
    message: reasonOf(issue),
    code: issue.code,
  }));
  const [first] = issues;
  const field = first?.path.join('.') ?? '';
  const reason = first?.message ?? 'The request is not valid.';
  return {
    error: 'validation_error',
    message: field === '' ? reason : `${field}: ${reason}`,
    issues,
  };
}

function handleError(error: Error, c: Context): Response {
  if (error instanceof AppError) {
    return new Response(JSON.stringify(error.toBody()), {
      status: error.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (error instanceof ZodError) return c.json(validationBody(error), 422);
  // The cause is for the log only: it can name a path, a query or a value.
  console.error(`${c.req.method} ${c.req.path} failed`, error);
  return c.json(
    { error: 'internal_error', message: 'Something went wrong.' },
    500,
  );
}

/**
 * The app. Every request passes the security checks first (`security.ts`).
 * Everything under `/api` is JSON and never cached: the answers are the
 * current state of the app.
 */
export function createApp({ manager, config, mcp }: AppDeps): Hono {
  const app = new Hono({ strict: false });

  app.onError(handleError);
  app.notFound((c) =>
    c.json({ error: 'not_found', message: NOTHING_HERE }, 404),
  );

  app.use(localOnly(config.allowedHosts));
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.route('/api/meta', createMetaRoutes(manager));
  app.route('/api/settings', createSettingsRoutes(manager));
  app.route('/api/secrets', createSecretRoutes(manager));
  app.route('/api/proxies', createProxyRoutes(manager));
  app.route('/api/sessions', createSessionRoutes(manager));

  // An endpoint of its own, not a request handler: it reads the request itself.
  app.all('/mcp', (c) => {
    if (mcp === undefined) {
      throw new AppError(404, 'not_found', NOTHING_HERE);
    }
    return mcp(c.req.raw);
  });

  return app;
}
