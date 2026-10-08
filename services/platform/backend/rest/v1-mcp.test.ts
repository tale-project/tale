import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpCaller } from '../domains/mcp/caller.ts';
import type { McpHost } from '../domains/mcp/protocol.ts';
import {
  RateLimitExceededError,
  checkUserRateLimit,
} from '../lib/rate-limit.ts';
import type { RestEnv } from './shared.ts';
import { createRestMcpRoutes } from './v1-mcp.ts';

/**
 * The MCP route behind the REST door: what it hands the protocol layer. The
 * door's authentication is `v1.ts`'s and the protocol is `protocol.test.ts`'s;
 * this holds the seam between them — the caller the door proved reaches the
 * engine whole, a batch's further calls draw from the key holder's budget,
 * and the header that cannot name a start is refused.
 */

const { engine, capability } = vi.hoisted(() => ({
  engine: vi.fn<McpHost['engine']>(),
  capability: vi.fn<McpHost['capability']>(),
}));

vi.mock('../domains/mcp/engine-host.ts', () => ({
  mcpHost: () => ({ engine, capability }),
}));
vi.mock('../lib/rate-limit.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/rate-limit.ts')>()),
  checkUserRateLimit: vi.fn(async () => undefined),
}));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mocked host and limiter never touch the handle
const sql = {} as Sql;

/** The MCP route behind a stand-in of the door, which proved a developer's
 * key in `acme`. */
function door(): Hono<RestEnv> {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-ada');
    c.set('userEmail', 'ada@example.test');
    c.set('organizationId', 'org-acme');
    c.set('orgSlug', 'acme');
    c.set('role', 'developer');
    c.set('orgExplicit', true);
    c.set('clientIp', '203.0.113.7');
    c.set('apiKeyId', 'key-laptop');
    c.set('requestId', 'req-7');
    await next();
  });
  app.route('/', createRestMcpRoutes({ sql }));
  return app;
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return door().request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const listCall = (id: number) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: 'list_automations', arguments: {} },
});

beforeEach(() => {
  vi.clearAllMocks();
  engine.mockResolvedValue({ automations: [] });
});

describe('POST /api/v1/mcp', () => {
  it('hands the engine the caller the door proved', async () => {
    const response = await post(listCall(1));

    expect(response.status).toBe(200);
    const caller: McpCaller = {
      organizationId: 'org-acme',
      orgSlug: 'acme',
      userId: 'user-ada',
      role: 'developer',
      credential: { kind: 'api-key', apiKeyId: 'key-laptop' },
      requestId: 'req-7',
    };
    expect(engine).toHaveBeenCalledWith(caller, 'list_automations', {});
    expect(checkUserRateLimit).not.toHaveBeenCalled();
  });

  it('charges every further call of a batch to the key holder’s request budget', async () => {
    vi.mocked(checkUserRateLimit)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new RateLimitExceededError('over', 1500));

    const response = await post([listCall(1), listCall(2), listCall(3)]);

    expect(checkUserRateLimit).toHaveBeenCalledTimes(2);
    expect(checkUserRateLimit).toHaveBeenCalledWith(
      sql,
      'rest:api',
      'user-ada',
    );
    expect(await response.json()).toMatchObject([
      { id: 1, result: expect.anything() },
      { id: 2, result: expect.anything() },
      { id: 3, error: { code: -32000, data: { retryAfterMs: 1500 } } },
    ]);
    expect(engine).toHaveBeenCalledTimes(2);
  });

  it('refuses an Idempotency-Key header and runs nothing', async () => {
    const response = await post(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'start_run', arguments: { name: 'billing/dunning' } },
      },
      { 'idempotency-key': 'k-1' },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 'INVALID_HEADER',
      data: { issues: [{ path: 'Idempotency-Key' }] },
    });
    expect(engine).not.toHaveBeenCalled();
  });
});
