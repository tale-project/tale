/**
 * Driving a REST handler in a unit test.
 *
 * A `/api/v1/*` handler is `withRestAuth(bucket, fn)` — an `httpAction` whose
 * whole job is to authenticate, resolve the organization, parse the request and
 * delegate to a Convex function. That delegation IS the contract worth pinning:
 * which backing function each route calls, with which arguments, and which
 * status each failure becomes.
 *
 * So a handler test mocks `httpAction` to the identity function (the wrapper's
 * own logic still runs) and calls the handler with the context built here. Every
 * `runQuery` / `runMutation` / `runAction` / `scheduler.runAfter` is routed by
 * the function's REGISTERED NAME, recorded, and answered by a stub — so an
 * unexpected call is a loud failure rather than an undefined that flows on.
 *
 * Each test file supplies its own module mocks (they must be hoisted per file):
 *
 * ```ts
 * vi.mock('../_generated/server', async (importOriginal) => ({
 *   ...(await importOriginal<Record<string, unknown>>()),
 *   httpAction: (handler: unknown) => handler,
 * }));
 * vi.mock('../lib/rate_limiter/helpers', () => ({
 *   checkIpRateLimit: vi.fn(),
 *   RateLimitExceededError: class extends Error {},
 * }));
 * vi.mock('../auth', () => ({ createAuth: () => ({ api: { getSession } }) }));
 * ```
 */

import { getFunctionName, type FunctionReference } from 'convex/server';

import type { HttpCtx } from './helpers';

export const TEST_ORG_ID = 'org_rest_kit';
export const TEST_ORG_SLUG = 'rest-kit';
export const TEST_USER_ID = 'user_rest_kit';

/** The registered name of a Convex function, e.g. `chat/rest_api:listThreads`. */
export type FunctionName = string;

export type StubHandler = (args: Record<string, unknown>) => unknown;

export type StubRoutes = Record<FunctionName, StubHandler>;

export interface StubCall {
  readonly name: FunctionName;
  readonly args: Record<string, unknown>;
}

export interface RestCtxOptions {
  /** The key holder's role in the organization — drives every capability gate.
   * `developer` by default, because most write endpoints need the capability and
   * a test that wants the refusal says so explicitly. */
  readonly role?: string | null;
  /** Organization the API key resolves to. */
  readonly organizationId?: string;
  readonly orgSlug?: string;
}

const TRUSTED_PROXIES = 'login_attempts/internal_queries:getTrustedProxies';
const RESOLVE_ORG =
  'organizations/resolve_user_organization:resolveUserOrganization';
const MEMBER_ROLE = 'members/internal_queries:getMemberRole';

/**
 * An `HttpCtx` whose Convex calls are answered by `routes`, keyed by registered
 * function name. The three calls every wrapped handler makes — trusted proxies,
 * org resolution, and (when a capability is checked) the member role — are
 * stubbed by default and overridable.
 */
export function restCtx(
  routes: StubRoutes = {},
  options: RestCtxOptions = {},
): { ctx: HttpCtx; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const table: StubRoutes = {
    [TRUSTED_PROXIES]: () => [],
    [RESOLVE_ORG]: () => ({
      organizationId: options.organizationId ?? TEST_ORG_ID,
      orgSlug: options.orgSlug ?? TEST_ORG_SLUG,
    }),
    [MEMBER_ROLE]: () =>
      options.role === undefined ? 'developer' : options.role,
    ...routes,
  };

  const call = async (reference: unknown, args: unknown): Promise<unknown> => {
    const name = getFunctionName(reference as FunctionReference<'query'>);
    const callArgs = (args ?? {}) as Record<string, unknown>;
    calls.push({ name, args: callArgs });
    const handler = table[name];
    if (!handler) {
      throw new Error(`[rest kit] no stub for Convex function "${name}"`);
    }
    return await handler(callArgs);
  };

  const ctx = {
    runQuery: call,
    runMutation: call,
    runAction: call,
    scheduler: {
      runAfter: async (_delay: number, reference: unknown, args: unknown) => {
        await call(reference, args);
        return 'scheduled_job';
      },
    },
  } as unknown as HttpCtx;

  return { ctx, calls };
}

/** The arguments one recorded call was made with, or undefined. */
export function argsOf(
  calls: StubCall[],
  name: FunctionName,
): Record<string, unknown> | undefined {
  return calls.find((entry) => entry.name === name)?.args;
}

/** Whether a function was called at all. */
export function called(calls: StubCall[], name: FunctionName): boolean {
  return calls.some((entry) => entry.name === name);
}

/** A request carrying a Bearer key — what every REST client sends. */
export function restRequest(
  path: string,
  init: RequestInit & { readonly json?: unknown } = {},
): Request {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('authorization', 'Bearer tale_test_key');
  if (json !== undefined) headers.set('content-type', 'application/json');
  return new Request(`https://tale.test${path}`, {
    ...rest,
    headers,
    ...(json !== undefined && {
      body: typeof json === 'string' ? json : JSON.stringify(json),
    }),
  });
}

/** The same request with NO Authorization header — the 401 path. */
export function anonymousRequest(
  path: string,
  init: RequestInit = {},
): Request {
  return new Request(`https://tale.test${path}`, init);
}

/** A JSON body, typed as a record so a test can read fields without casts. */
export async function jsonBody(
  response: Response,
): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** The session a valid API key resolves to. */
export function testSession(): {
  user: { id: string; email: string; name: string };
} {
  return {
    user: {
      id: TEST_USER_ID,
      email: 'key@tale.test',
      name: 'REST key holder',
    },
  };
}
