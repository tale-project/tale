// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.ts';
import type { Auth } from './auth/auth.ts';

/**
 * The connector bridge's MCP server as the REAL app mounts it: its own
 * tests drive the route app alone (`domains/connectors/bridge-mcp.test.ts`);
 * only `createApp` proves `/api/connectors/mcp` reaches it beside the
 * bridge's doors and through the app-wide middleware, with the session
 * token as its only key, and answers what a door lets escape as the app
 * answers the relay.
 */

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: no session token row matches
const noTokens = (() => Promise.resolve([])) as unknown as Sql;

/** A database that answers the endpoint's token lookup with a live token,
 * then goes down: the door's own lookup meets the restart. */
function databaseGoingDown(): Sql {
  let lookups = 0;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: only the token lookups answer
  return ((strings: unknown) => {
    if (
      !Array.isArray(strings) ||
      !strings.join('?').includes('app.sandbox_session_tokens')
    ) {
      return Promise.resolve([]);
    }
    lookups += 1;
    if (lookups > 1) {
      return Promise.reject(
        Object.assign(
          new Error('terminating connection due to administrator command'),
          { code: '57P01' },
        ),
      );
    }
    return Promise.resolve([
      {
        organizationId: 'org_1',
        sessionId: 'ses_1',
        scope: { connectorGrants: ['tavily'] },
        llmGatewayKeyId: null,
        expiresAt: Date.now() + 3_600_000,
        revokedAt: null,
      },
    ]);
  }) as unknown as Sql;
}

function app(sql: Sql = noTokens) {
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

  it('answers a door’s database outage as the app answers the relay, under the request’s id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const res = await app(databaseGoingDown()).request(
        'http://localhost/api/connectors/mcp',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: 'Bearer tok-live',
            'x-request-id': 'req-outage',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 7,
            method: 'tools/call',
            params: { name: 'connector_status', arguments: {} },
          }),
        },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        jsonrpc: '2.0',
        id: 7,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error:
                  'The platform’s database is not answering right now — it may be restarting; retry with backoff',
                code: 'DATABASE_UNAVAILABLE',
                requestId: 'req-outage',
              }),
            },
          ],
          isError: true,
        },
      });
      // Logged under the door's path, as the relay's call is.
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'database unavailable — 503 for POST /api/connectors/status',
        ),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('opens no stream: GET answers 405', async () => {
    const res = await app().request('http://localhost/api/connectors/mcp', {
      headers: { authorization: 'Bearer not-a-session' },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
