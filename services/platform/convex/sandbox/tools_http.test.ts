// Coverage for the /api/tools/{execute,status} HTTP handlers — the auth +
// grant gate in front of the workspace-tool dispatch. Locks the red-team rule:
// org, user, and toolGrants come from the session token row (authSessionToken),
// never the request body, and an ungranted tool never reaches dispatch.

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
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
  const mod = await import('./tools_http');
  return {
    execute: mod.toolsExecuteHandler as unknown as HttpHandler,
    status: mod.toolsStatusHandler as unknown as HttpHandler,
  };
}

const AUTH = {
  organizationId: 'org_1',
  sessionId: 'session_1',
  connectorGrants: [],
  toolGrants: ['rag_search'],
  userId: 'user_1',
};

function postJson(body: unknown): Request {
  return new Request('http://convex/api/tools/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('toolsExecuteHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401s an unauthenticated call', async () => {
    mockAuthSessionToken.mockResolvedValue(null);
    const ctx = { runAction: vi.fn() };
    const { execute } = await getHandlers();
    const res = await execute(ctx, postJson({ tool: 'rag_search' }));
    expect(res.status).toBe(401);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('dispatches a granted tool, passing org+user from the token (not the body)', async () => {
    mockAuthSessionToken.mockResolvedValue(AUTH);
    const runAction = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ status: 'ok', output: {} }),
    );
    const { execute } = await getHandlers();
    // The body tries to smuggle another org/user — must be ignored.
    const res = await execute(
      { runAction },
      postJson({
        tool: 'rag_search',
        args: { query: 'x' },
        organizationId: 'org_EVIL',
        userId: 'user_EVIL',
      }),
    );
    expect(res.status).toBe(200);
    expect(runAction).toHaveBeenCalledTimes(1);
    const dispatchArgs = runAction.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(dispatchArgs.organizationId).toBe('org_1');
    expect(dispatchArgs.userId).toBe('user_1');
    expect(dispatchArgs.sessionId).toBe('session_1');
    expect(dispatchArgs.tool).toBe('rag_search');
  });

  it('refuses an ungranted tool WITHOUT dispatching', async () => {
    mockAuthSessionToken.mockResolvedValue(AUTH);
    const runAction = vi.fn();
    const { execute } = await getHandlers();
    const res = await execute(
      { runAction },
      postJson({ tool: 'document_find' }), // not in AUTH.toolGrants
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'unavailable' });
    expect(runAction).not.toHaveBeenCalled();
  });

  it('needs a tool name', async () => {
    mockAuthSessionToken.mockResolvedValue(AUTH);
    const runAction = vi.fn();
    const { execute } = await getHandlers();
    const res = await execute({ runAction }, postJson({ args: {} }));
    expect(await res.json()).toMatchObject({ status: 'invalid_args' });
    expect(runAction).not.toHaveBeenCalled();
  });
});

describe('toolsStatusHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401s an unauthenticated call', async () => {
    mockAuthSessionToken.mockResolvedValue(null);
    const { status } = await getHandlers();
    const res = await status(
      { runAction: vi.fn() },
      new Request('http://convex/api/tools/status', { method: 'POST' }),
    );
    expect(res.status).toBe(401);
  });

  it('lists the token row grants, never a body-supplied set', async () => {
    mockAuthSessionToken.mockResolvedValue(AUTH);
    const runAction = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ tools: [] }),
    );
    const { status } = await getHandlers();
    await status(
      { runAction },
      new Request('http://convex/api/tools/status', { method: 'POST' }),
    );
    const args = runAction.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args.grants).toEqual(['rag_search']);
  });
});
