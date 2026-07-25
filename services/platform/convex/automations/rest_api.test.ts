/**
 * The automations REST surface, driven handler-first.
 *
 * What these tests hold: the URL codec (a `/`-separated automation name travels
 * as `__` and comes back REAL in every response), the method/sub-resource
 * dispatch a path-prefix router forces on us, the capability rule (a live run
 * needs the developer capability, a mock run does not), and the status each
 * coded refusal becomes. The backing functions are stubbed by NAME, so a route
 * that starts calling a different function fails here.
 */

import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `withRestAuth` returns an `httpAction`; the identity mock keeps the wrapper's
// own logic (auth, org resolution, error mapping) while making the handler
// directly callable with a supplied context.
vi.mock('../_generated/server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  httpAction: (handler: unknown) => handler,
}));

vi.mock('../lib/rate_limiter/helpers', () => ({
  checkIpRateLimit: vi.fn(),
  RateLimitExceededError: class RateLimitExceededError extends Error {},
}));

const getSession = vi.fn();
vi.mock('../auth', () => ({
  createAuth: () => ({ api: { getSession } }),
}));

import {
  automationSlugToParam,
  paramToAutomationSlug,
} from '../../lib/automations/slug';
import {
  anonymousRequest,
  argsOf,
  called,
  jsonBody,
  restCtx,
  restRequest,
  testSession,
  TEST_ORG_ID,
  TEST_USER_ID,
  type StubRoutes,
} from '../lib/rest/handler_kit.testkit';
import { restOptionsHandler, type HttpCtx } from '../lib/rest/helpers';
import {
  automationDeleteActions,
  automationPostActions,
  automationPutActions,
  automationReads,
  getAutomationRun,
  listAutomations,
  runPostActions,
} from './rest_api';

/** Every handler is `(ctx, request) => Response` once `httpAction` is identity. */
type Handler = (ctx: HttpCtx, request: Request) => Promise<Response>;

const LIST = 'automations/rest_api:restListAutomations';
const GET = 'automations/rest_api:restGetAutomation';
const VERSIONS = 'automations/rest_api:restListVersions';
const RUNS = 'automations/rest_api:restListRuns';
const GET_RUN = 'automations/rest_api:restGetRun';
const TRIGGERS = 'automations/rest_api:restListTriggers';
const START = 'automations/rest_api:restStartRun';
const SET_TRIGGER = 'automations/rest_api:restSetTrigger';
const DELETE_TRIGGER = 'automations/rest_api:restDeleteTrigger';
const CANCEL = 'automations/rest_api:restCancelRun';

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(testSession());
});

describe('automation name codec', () => {
  it('round-trips a path name through a single URL segment', () => {
    expect(automationSlugToParam('billing/dunning-reminder')).toBe(
      'billing__dunning-reminder',
    );
    expect(paramToAutomationSlug('billing__dunning-reminder')).toBe(
      'billing/dunning-reminder',
    );
    expect(paramToAutomationSlug(automationSlugToParam('a/b/c_d'))).toBe(
      'a/b/c_d',
    );
  });
});

describe('authentication', () => {
  it('refuses a request with no Authorization header (401)', async () => {
    const { ctx } = restCtx();
    const response = await (listAutomations as unknown as Handler)(
      ctx,
      anonymousRequest('/api/v1/automations'),
    );
    expect(response.status).toBe(401);
    expect(await jsonBody(response)).toEqual({
      error: 'Missing or invalid Authorization header',
    });
  });

  it('refuses a key Better Auth does not resolve (401)', async () => {
    getSession.mockResolvedValue(null);
    const { ctx } = restCtx();
    const response = await (listAutomations as unknown as Handler)(
      ctx,
      restRequest('/api/v1/automations'),
    );
    expect(response.status).toBe(401);
  });
});

describe('GET /api/v1/automations', () => {
  const page = {
    page: [{ name: 'billing/dunning-reminder', latest: 3, deployedVersion: 2 }],
    isDone: true,
    continueCursor: '',
  };

  it('lists the organization from the key, with the cursor and clamped limit', async () => {
    const { ctx, calls } = restCtx({ [LIST]: () => page });
    const response = await (listAutomations as unknown as Handler)(
      ctx,
      restRequest('/api/v1/automations?cursor=ops%2Fx&limit=9999'),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual(page);
    expect(argsOf(calls, LIST)).toEqual({
      organizationId: TEST_ORG_ID,
      cursor: 'ops/x',
      limit: 100,
    });
  });

  it('passes a projectId filter through', async () => {
    const { ctx, calls } = restCtx({ [LIST]: () => page });
    await (listAutomations as unknown as Handler)(
      ctx,
      restRequest('/api/v1/automations?projectId=proj_1'),
    );
    expect(argsOf(calls, LIST)?.projectId).toBe('proj_1');
  });
});

describe('GET /api/v1/automations/:name/...', () => {
  const reads = automationReads as unknown as Handler;

  it('decodes the name and answers the document', async () => {
    const { ctx, calls } = restCtx({
      [GET]: () => ({
        name: 'billing/dunning-reminder',
        version: 3,
        document: { name: 'billing/dunning-reminder' },
        createdBy: 'user_1',
        createdAt: 1,
      }),
    });
    const response = await reads(
      ctx,
      restRequest('/api/v1/automations/billing__dunning-reminder'),
    );
    expect(response.status).toBe(200);
    expect(argsOf(calls, GET)).toEqual({
      organizationId: TEST_ORG_ID,
      name: 'billing/dunning-reminder',
    });
    expect((await jsonBody(response)).name).toBe('billing/dunning-reminder');
  });

  it('reads an explicit version and refuses a non-numeric one', async () => {
    const { ctx, calls } = restCtx({
      [GET]: () => ({
        name: 'ops/x',
        version: 2,
        document: {},
        createdBy: 'u',
        createdAt: 1,
      }),
    });
    await reads(ctx, restRequest('/api/v1/automations/ops__x?version=2'));
    expect(argsOf(calls, GET)?.version).toBe(2);

    const bad = await reads(
      ctx,
      restRequest('/api/v1/automations/ops__x?version=latest'),
    );
    expect(bad.status).toBe(400);
  });

  it('answers 404 for an automation this organization does not have', async () => {
    const { ctx } = restCtx({ [GET]: () => null });
    const response = await reads(
      ctx,
      restRequest('/api/v1/automations/ops__x'),
    );
    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: 'Automation not found' });
  });

  it('serves versions, runs and triggers under the real name', async () => {
    const { ctx, calls } = restCtx({
      [VERSIONS]: () => [{ version: 1, createdBy: 'u', createdAt: 1 }],
      [RUNS]: () => ({ page: [], isDone: true, continueCursor: '' }),
      [TRIGGERS]: () => [
        { name: 'ops/x', kind: 'schedule', hasToken: false, enabled: true },
      ],
    });

    const versions = await reads(
      ctx,
      restRequest('/api/v1/automations/ops__x/versions'),
    );
    expect(await jsonBody(versions)).toEqual({
      name: 'ops/x',
      versions: [{ version: 1, createdBy: 'u', createdAt: 1 }],
    });

    await reads(
      ctx,
      restRequest('/api/v1/automations/ops__x/runs?cursor=c1&limit=5'),
    );
    expect(argsOf(calls, RUNS)).toEqual({
      organizationId: TEST_ORG_ID,
      name: 'ops/x',
      cursor: 'c1',
      limit: 5,
    });

    const triggers = await reads(
      ctx,
      restRequest('/api/v1/automations/ops__x/triggers'),
    );
    expect((await jsonBody(triggers)).name).toBe('ops/x');
  });

  it('answers 404 for an unknown sub-resource and 400 for no name', async () => {
    const { ctx } = restCtx();
    expect(
      (await reads(ctx, restRequest('/api/v1/automations/ops__x/nope'))).status,
    ).toBe(404);
    expect((await reads(ctx, restRequest('/api/v1/automations/'))).status).toBe(
      400,
    );
  });
});

describe('POST /api/v1/automations/:name/runs', () => {
  const post = automationPostActions as unknown as Handler;
  const started: StubRoutes = {
    [START]: () => ({ runId: 'run_1', version: 4 }),
  };

  it('starts a live run for a developer and answers 202', async () => {
    const { ctx, calls } = restCtx(started, { role: 'developer' });
    const response = await post(
      ctx,
      restRequest('/api/v1/automations/ops__x/runs', {
        method: 'POST',
        json: { input: { invoice: 7 } },
      }),
    );
    expect(response.status).toBe(202);
    expect(await jsonBody(response)).toEqual({
      runId: 'run_1',
      version: 4,
      name: 'ops/x',
      mode: 'live',
    });
    expect(argsOf(calls, START)).toEqual({
      organizationId: TEST_ORG_ID,
      name: 'ops/x',
      input: { invoice: 7 },
      mode: 'live',
      startedBy: `api-key:${TEST_USER_ID}`,
    });
  });

  it('needs no body at all', async () => {
    const { ctx, calls } = restCtx(started);
    const response = await post(
      ctx,
      restRequest('/api/v1/automations/ops__x/runs', { method: 'POST' }),
    );
    expect(response.status).toBe(202);
    expect(argsOf(calls, START)?.input).toEqual({});
  });

  it('refuses a live run for a member without the developer capability (403)', async () => {
    const { ctx, calls } = restCtx(started, { role: 'member' });
    const response = await post(
      ctx,
      restRequest('/api/v1/automations/ops__x/runs', {
        method: 'POST',
        json: {},
      }),
    );
    expect(response.status).toBe(403);
    // The refusal happens BEFORE the run is created.
    expect(called(calls, START)).toBe(false);
  });

  it('allows a mock run for a plain member — it reaches nothing outside', async () => {
    const { ctx, calls } = restCtx(started, { role: 'member' });
    const response = await post(
      ctx,
      restRequest('/api/v1/automations/ops__x/runs', {
        method: 'POST',
        json: { mode: 'mock' },
      }),
    );
    expect(response.status).toBe(202);
    expect(argsOf(calls, START)?.mode).toBe('mock');
  });

  it('maps AUTOMATION_NOT_DEPLOYED to 409 with its message', async () => {
    const { ctx } = restCtx({
      [START]: () => {
        throw new ConvexError({
          code: 'AUTOMATION_NOT_DEPLOYED',
          message: '"ops/x" has no version to run',
        });
      },
    });
    const response = await post(
      ctx,
      restRequest('/api/v1/automations/ops__x/runs', {
        method: 'POST',
        json: {},
      }),
    );
    expect(response.status).toBe(409);
    expect(await jsonBody(response)).toEqual({
      error: '"ops/x" has no version to run',
    });
  });

  it('refuses a bad mode, a bad version and a malformed body (400)', async () => {
    const { ctx } = restCtx(started);
    for (const json of [
      { mode: 'dry-run' },
      { version: 0 },
      { version: 'latest' },
    ]) {
      const response = await post(
        ctx,
        restRequest('/api/v1/automations/ops__x/runs', {
          method: 'POST',
          json,
        }),
      );
      expect(response.status).toBe(400);
    }
    const malformed = await post(
      ctx,
      restRequest('/api/v1/automations/ops__x/runs', {
        method: 'POST',
        json: 'not json at all',
      }),
    );
    expect(malformed.status).toBe(400);
  });

  it('answers 404 for a POST that is not a run', async () => {
    const { ctx } = restCtx(started);
    const response = await post(
      ctx,
      restRequest('/api/v1/automations/ops__x/deploy', { method: 'POST' }),
    );
    expect(response.status).toBe(404);
  });
});

describe('PUT and DELETE /api/v1/automations/:name/triggers', () => {
  const put = automationPutActions as unknown as Handler;
  const del = automationDeleteActions as unknown as Handler;

  it('binds a schedule trigger', async () => {
    const { ctx, calls } = restCtx({ [SET_TRIGGER]: () => ({}) });
    const response = await put(
      ctx,
      restRequest('/api/v1/automations/ops__x/triggers', {
        method: 'PUT',
        json: {
          kind: 'schedule',
          cron: '0 9 * * *',
          timezone: 'Europe/Zurich',
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(argsOf(calls, SET_TRIGGER)).toEqual({
      organizationId: TEST_ORG_ID,
      actor: TEST_USER_ID,
      name: 'ops/x',
      trigger: {
        kind: 'schedule',
        cron: '0 9 * * *',
        timezone: 'Europe/Zurich',
      },
    });
  });

  it('returns a freshly minted webhook token exactly as the mutation gave it', async () => {
    const { ctx } = restCtx({ [SET_TRIGGER]: () => ({ token: 'wh_secret' }) });
    const response = await put(
      ctx,
      restRequest('/api/v1/automations/ops__x/triggers', {
        method: 'PUT',
        json: { kind: 'webhook', rotateToken: true },
      }),
    );
    expect(await jsonBody(response)).toEqual({
      name: 'ops/x',
      token: 'wh_secret',
    });
  });

  it('refuses an unknown or missing kind (400), including the retired api-key', async () => {
    const { ctx } = restCtx({ [SET_TRIGGER]: () => ({}) });
    for (const json of [{}, { kind: 'api-key' }, { kind: 'cron' }]) {
      const response = await put(
        ctx,
        restRequest('/api/v1/automations/ops__x/triggers', {
          method: 'PUT',
          json,
        }),
      );
      expect(response.status).toBe(400);
    }
  });

  it('needs the developer capability for both writes (403)', async () => {
    const { ctx, calls } = restCtx(
      {
        [SET_TRIGGER]: () => ({}),
        [DELETE_TRIGGER]: () => ({ deleted: true }),
      },
      { role: 'member' },
    );
    const bound = await put(
      ctx,
      restRequest('/api/v1/automations/ops__x/triggers', {
        method: 'PUT',
        json: { kind: 'event', event: 'ticket.created' },
      }),
    );
    expect(bound.status).toBe(403);
    const unbound = await del(
      ctx,
      restRequest('/api/v1/automations/ops__x/triggers', { method: 'DELETE' }),
    );
    expect(unbound.status).toBe(403);
    expect(called(calls, SET_TRIGGER)).toBe(false);
    expect(called(calls, DELETE_TRIGGER)).toBe(false);
  });

  it('unbinds the trigger with 204 — the name IS the identifier', async () => {
    const { ctx, calls } = restCtx({
      [DELETE_TRIGGER]: () => ({ deleted: true }),
    });
    const response = await del(
      ctx,
      restRequest('/api/v1/automations/ops__x/triggers', { method: 'DELETE' }),
    );
    expect(response.status).toBe(204);
    expect(argsOf(calls, DELETE_TRIGGER)).toEqual({
      organizationId: TEST_ORG_ID,
      name: 'ops/x',
    });
  });
});

describe('/api/v1/runs/:runId', () => {
  const get = getAutomationRun as unknown as Handler;
  const post = runPostActions as unknown as Handler;

  it('answers one run, and 404 for a run of another organization', async () => {
    const { ctx, calls } = restCtx({
      [GET_RUN]: () => ({
        id: 'run_1',
        name: 'ops/x',
        version: 1,
        status: 'success',
        mode: 'live',
        startedBy: 'api-key:user_1',
        input: {},
        startedAt: 1,
      }),
    });
    const found = await get(ctx, restRequest('/api/v1/runs/run_1'));
    expect(found.status).toBe(200);
    expect(argsOf(calls, GET_RUN)).toEqual({
      organizationId: TEST_ORG_ID,
      runId: 'run_1',
    });

    const { ctx: missingCtx } = restCtx({ [GET_RUN]: () => null });
    const missing = await get(missingCtx, restRequest('/api/v1/runs/run_x'));
    expect(missing.status).toBe(404);
  });

  it('cancels a run and reports whether it had to', async () => {
    const { ctx } = restCtx({ [CANCEL]: () => ({ cancelled: true }) });
    const response = await post(
      ctx,
      restRequest('/api/v1/runs/run_1/cancel', { method: 'POST' }),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({ cancelled: true });
  });

  it('refuses a cancel without the developer capability (403)', async () => {
    const { ctx, calls } = restCtx(
      { [CANCEL]: () => ({ cancelled: true }) },
      { role: 'member' },
    );
    const response = await post(
      ctx,
      restRequest('/api/v1/runs/run_1/cancel', { method: 'POST' }),
    );
    expect(response.status).toBe(403);
    expect(called(calls, CANCEL)).toBe(false);
  });

  it('answers 404 for an unknown run action and for a bare id on POST', async () => {
    const { ctx } = restCtx({ [CANCEL]: () => ({ cancelled: true }) });
    expect(
      (
        await post(
          ctx,
          restRequest('/api/v1/runs/run_1/retry', { method: 'POST' }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await post(ctx, restRequest('/api/v1/runs/run_1', { method: 'POST' })))
        .status,
    ).toBe(404);
  });

  it('rejects a sub-path on the run read', async () => {
    const { ctx } = restCtx({ [GET_RUN]: () => null });
    const response = await get(ctx, restRequest('/api/v1/runs/run_1/trace'));
    expect(response.status).toBe(404);
  });
});

describe('CORS preflight', () => {
  it('answers OPTIONS with 204 and the methods this surface uses', async () => {
    const handler = restOptionsHandler as unknown as Handler;
    const { ctx } = restCtx();
    const response = await handler(ctx, restRequest('/api/v1/automations'));
    expect(response.status).toBe(204);
    const methods = response.headers.get('Access-Control-Allow-Methods') ?? '';
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
      expect(methods).toContain(method);
    }
  });
});
