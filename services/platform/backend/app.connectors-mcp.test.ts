// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.ts';
import type { Auth } from './auth/auth.ts';

/**
 * The connector bridge's MCP server as the REAL app mounts it: its own
 * tests drive the route app alone (`domains/connectors/bridge-mcp.test.ts`);
 * only `createApp` proves `/api/connectors/mcp` reaches it beside the
 * bridge's doors and through the app-wide middleware, with the session
 * token as its only key.
 */

function app() {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: no session token row matches
  const sql = (() => Promise.resolve([])) as unknown as Sql;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: the bridge never reads a browser session
  const auth = {
    resolveSessionAuthority: async (bundle: unknown) => bundle,
    api: { getSession: () => Promise.resolve(null) },
    options: { baseURL: 'http://localhost' },
    handler: () => Promise.resolve(new Response(null, { status: 404 })),
  } as unknown as Auth;
  return createApp({ sql, auth });
}

const initialize = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {} },
});

describe('the connector bridge MCP server through the real app', () => {
  it.each([
    ['no token', {}],
    ['a token Tale never issued', { authorization: 'Bearer not-a-session' }],
  ])('refuses %s before the handshake', async (_name, headers) => {
    const res = await app().request('http://localhost/api/connectors/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: initialize,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Unauthorized.' },
    });
  });

  it('opens no stream: GET answers 405', async () => {
    const res = await app().request('http://localhost/api/connectors/mcp', {
      headers: { authorization: 'Bearer not-a-session' },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
