// Coverage for the /api/integrations/{execute,status} HTTP handlers — the
// auth + grant gate in front of the bridge dispatch. Locks the red-team rule:
// org, user, and grants come from the session token row (authSessionToken),
// never from the request body, and an ungranted slug never reaches dispatch.

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    // Handlers become plain (ctx, request) → Response functions.
    httpAction: (
      handler: (ctx: unknown, request: Request) => Promise<Response>,
    ) => handler,
  };
});

const mockAuthSessionToken = vi.fn();
vi.mock('./dispatch_auth', () => ({
  authSessionToken: (...args: unknown[]) => mockAuthSessionToken(...args),
}));

type HttpHandler = (ctx: unknown, request: Request) => Promise<Response>;

async function getHandlers(): Promise<{
  execute: HttpHandler;
  status: HttpHandler;
}> {
  const mod = await import('./integrations_http');
  return {
    execute: mod.integrationsExecuteHandler as unknown as HttpHandler,
    status: mod.integrationsStatusHandler as unknown as HttpHandler,
  };
}

const AUTH = {
  organizationId: 'org_1',
  sessionId: 'session_1',
  integrationGrants: ['tavily'],
  toolGrants: [],
  userId: 'user_1',
};

function postJson(body: unknown): Request {
  return new Request('http://convex/api/integrations/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('integrationsExecuteHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401s an unauthenticated call', async () => {
    mockAuthSessionToken.mockResolvedValue(null);
    const ctx = { runAction: vi.fn() };
    const { execute } = await getHandlers();

    const res = await execute(
      ctx,
      postJson({ slug: 'tavily', operation: 'search' }),
    );

    expect(res.status).toBe(401);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('answers invalid_args for a non-JSON body', async () => {
    mockAuthSessionToken.mockResolvedValue(AUTH);
    const ctx = { runAction: vi.fn() };
    const { execute } = await getHandlers();

    const res = await execute(
      ctx,
      new Request('http://convex/api/integrations/execute', {
        method: 'POST',
        body: 'not json',
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'invalid_args' });
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('requires slug and operation', async () => {
    mockAuthSessionToken.mockResolvedValue(AUTH);
    const ctx = { runAction: vi.fn() };
    const { execute } = await getHandlers();

    const res = await execute(ctx, postJson({ slug: 'tavily' }));

    expect(await res.json()).toMatchObject({ status: 'invalid_args' });
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('refuses an ungranted slug before dispatch', async () => {
    mockAuthSessionToken.mockResolvedValue(AUTH);
    const ctx = { runAction: vi.fn() };
    const { execute } = await getHandlers();

    const res = await execute(
      ctx,
      postJson({ slug: 'github', operation: 'list_repos' }),
    );

    expect(await res.json()).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'not_granted' }],
    });
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('refuses a token without user context', async () => {
    mockAuthSessionToken.mockResolvedValue({ ...AUTH, userId: undefined });
    const ctx = { runAction: vi.fn() };
    const { execute } = await getHandlers();

    const res = await execute(
      ctx,
      postJson({ slug: 'tavily', operation: 'search' }),
    );

    expect(await res.json()).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'no_user_context' }],
    });
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('dispatches a granted call with token-derived identity only', async () => {
    mockAuthSessionToken.mockResolvedValue(AUTH);
    const runAction = vi
      .fn()
      .mockResolvedValue({ status: 'ok', output: { results: [] } });
    const ctx = { runAction };
    const { execute } = await getHandlers();

    const res = await execute(
      ctx,
      postJson({
        slug: 'tavily',
        operation: 'search',
        args: { query: 'hi' },
        // Body-supplied identity must be ignored.
        organizationId: 'org_evil',
        userId: 'user_evil',
      }),
    );

    expect(runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org_1',
        userId: 'user_1',
        slug: 'tavily',
        operation: 'search',
        callArgs: { query: 'hi' },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', output: { results: [] } });
  });
});

describe('integrationsStatusHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401s an unauthenticated call', async () => {
    mockAuthSessionToken.mockResolvedValue(null);
    const ctx = { runAction: vi.fn() };
    const { status } = await getHandlers();

    const res = await status(
      ctx,
      new Request('http://convex/api/integrations/status', { method: 'POST' }),
    );

    expect(res.status).toBe(401);
  });

  it("reports the token's grant set", async () => {
    mockAuthSessionToken.mockResolvedValue(AUTH);
    const runAction = vi.fn().mockResolvedValue({ integrations: [] });
    const ctx = { runAction };
    const { status } = await getHandlers();

    const res = await status(
      ctx,
      new Request('http://convex/api/integrations/status', { method: 'POST' }),
    );

    expect(runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org_1', grants: ['tavily'] }),
    );
    expect(res.status).toBe(200);
  });
});
