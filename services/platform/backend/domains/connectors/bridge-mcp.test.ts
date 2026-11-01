// @vitest-environment node

/**
 * The bridge's remote MCP server is the stdio relay moved into the platform
 * [CONN-R33]: every message below goes to the real relay
 * (`services/sandbox-runtime/tale-connectors-mcp`, over HTTP to the same
 * stub doors) and to the endpoint, and the two answers must be equal — the
 * tools, their results, the refusals and the bounds. The doors see the same
 * body and the same token from both.
 *
 * Every request presents its own live session token [CONN-R34]: a missing,
 * malformed, unknown, revoked (its session destroyed) or expired token is
 * refused before anything runs, and each request reaches the doors with its
 * own token only.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

vi.mock('./service.ts', () => ({ runConnectorAction: vi.fn() }));
vi.mock('../connector_credentials/service.ts', () => ({
  resolveConnectorCredential: vi.fn(),
}));
vi.mock('../../core/connectors/hostcall_token.ts', () => ({
  verifyHostcallToken: vi.fn(),
}));

const { createConnectorBridgeMcpRoutes } = await import('./bridge-mcp.ts');

const RELAY = resolve(
  import.meta.dirname,
  '../../../../sandbox-runtime/tale-connectors-mcp',
);
const LIVE = 'tok-live';
const OTHER = 'tok-other';
const REQUEST_TIMEOUT_MS = 300;
const LONG_REQUEST_TIMEOUT_MS = 3_000;
const PROGRESS_INTERVAL_MS = 100;

const sha256 = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** The token table `getSessionTokenByHash` reads, by hash. */
const tokenRows = new Map<string, Record<string, unknown>>();
function tokenRow(
  sessionId: string,
  overrides: { expiresAt?: number; revokedAt?: number | null } = {},
): Record<string, unknown> {
  return {
    organizationId: 'org_1',
    sessionId,
    scope: { connectorGrants: ['tavily'] },
    llmGatewayKeyId: null,
    expiresAt: overrides.expiresAt ?? Date.now() + 3_600_000,
    revokedAt: overrides.revokedAt ?? null,
  };
}
const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
  const row = strings.join('?').includes('app.sandbox_session_tokens')
    ? tokenRows.get(String(values[0]))
    : undefined;
  return Promise.resolve(row === undefined ? [] : [row]);
}) as unknown as Sql;

interface DoorCall {
  door: 'connectors' | 'tools';
  path: string;
  authorization: string | null;
  body: unknown;
}
const doorCalls: DoorCall[] = [];

const sleep = (ms: number) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/** What a door answers, by the call: JSON for most, an HTML error page, a
 * refusal and a call that outlives the bound for the rest. */
async function answer(call: DoorCall): Promise<Response> {
  const body = call.body as Record<string, unknown>;
  const json = (status: number, value: unknown) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  if (call.path === '/status') {
    return json(200, { door: call.door, status: 'listed', note: 'Ünïcode …' });
  }
  const name = String(body.slug ?? body.tool);
  if (name === 'html') {
    return new Response('<html>bad gateway: internal detail</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    });
  }
  if (name === 'refused') {
    return json(401, { status: 'error', message: 'Unauthorized.' });
  }
  if (name === 'unavailable') {
    return json(200, {
      status: 'unavailable',
      blockers: [{ code: 'no_credential', guidance: 'Connect it.' }],
    });
  }
  if (name === 'slow') {
    await sleep(REQUEST_TIMEOUT_MS * 3);
  }
  if (name === 'generate_image') {
    await sleep(PROGRESS_INTERVAL_MS * 3.5);
  }
  return json(200, { status: 'ok', output: { echo: body } });
}

function stubDoor(door: DoorCall['door']): Hono {
  const app = new Hono();
  for (const path of ['/execute', '/status']) {
    app.post(path, async (c) => {
      const call: DoorCall = {
        door,
        path,
        authorization: c.req.header('authorization') ?? null,
        body: await c.req.json(),
      };
      doorCalls.push(call);
      return answer(call);
    });
  }
  return app;
}

const connectorsDoor = stubDoor('connectors');
const toolsDoor = stubDoor('tools');

/** The platform as the relay and the harness see it: the two doors and
 * the endpoint, mounted where `app.ts` mounts them. */
const platform = new Hono();
platform.route('/api/connectors', connectorsDoor);
platform.route('/api/tools', toolsDoor);
platform.route(
  '/api/connectors/mcp',
  createConnectorBridgeMcpRoutes({
    sql,
    doors: { connectors: connectorsDoor, tools: toolsDoor },
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    longRequestTimeoutMs: LONG_REQUEST_TIMEOUT_MS,
    progressIntervalMs: PROGRESS_INTERVAL_MS,
  }),
);

let server: Server;
let relay: ChildProcessWithoutNullStreams;
const relayLines: Record<string, unknown>[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(key, value);
      }
      void Promise.resolve(
        platform.request(req.url ?? '/', {
          method: req.method,
          headers,
          body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
        }),
      ).then(async (response) => {
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
    });
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, '127.0.0.1', resolveListen),
  );
  const { port } = server.address() as AddressInfo;
  relay = spawn('node', [RELAY], {
    env: {
      PATH: process.env.PATH ?? '',
      TALE_CONNECTORS_URL: `http://127.0.0.1:${port}/api/connectors`,
      TALE_CONNECTORS_TOKEN: LIVE,
      TALE_CONNECTORS_REQUEST_TIMEOUT_MS: String(REQUEST_TIMEOUT_MS),
      TALE_CONNECTORS_LONG_REQUEST_TIMEOUT_MS: String(LONG_REQUEST_TIMEOUT_MS),
      TALE_CONNECTORS_PROGRESS_INTERVAL_MS: String(PROGRESS_INTERVAL_MS),
    },
  });
  let buffer = '';
  relay.stdout.setEncoding('utf8');
  relay.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line !== '')
        relayLines.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
});

afterAll(async () => {
  relay.stdin.end();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
});

beforeEach(() => {
  doorCalls.length = 0;
  tokenRows.clear();
  tokenRows.set(sha256(LIVE), tokenRow('ses_live'));
  tokenRows.set(sha256(OTHER), tokenRow('ses_other'));
});

let nextId = 1;

/** One message through the relay: its answer, and the progress it sent. */
async function viaRelay(
  message: Record<string, unknown>,
): Promise<{ answer: unknown; progress: unknown[] }> {
  const id = message.id;
  relay.stdin.write(`${JSON.stringify(message)}\n`);
  for (let waited = 0; waited < 10_000; waited += 10) {
    const index = relayLines.findIndex((line) => line.id === id);
    if (index !== -1) {
      const progress = relayLines.filter(
        (line) => line.method === 'notifications/progress',
      );
      const [found] = relayLines.splice(index, 1);
      relayLines.length = 0;
      return { answer: found, progress };
    }
    await sleep(10);
  }
  throw new Error(`the relay never answered message ${String(id)}`);
}

function viaEndpoint(
  message: unknown,
  init: { token?: string | null; accept?: string; method?: string } = {},
): Promise<Response> {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: init.accept ?? 'application/json, text/event-stream',
  });
  const token = init.token === undefined ? LIVE : init.token;
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  return Promise.resolve(
    platform.request('/api/connectors/mcp', {
      method: init.method ?? 'POST',
      headers,
      ...(init.method === undefined || init.method === 'POST'
        ? {
            body:
              typeof message === 'string' ? message : JSON.stringify(message),
          }
        : {}),
    }),
  );
}

/** The same message through both, with the door calls each one made. */
async function both(message: Record<string, unknown>) {
  const id = nextId++;
  doorCalls.length = 0;
  const relayed = await viaRelay({ ...message, id });
  const relayDoorCalls = [...doorCalls];
  doorCalls.length = 0;
  const response = await viaEndpoint({ ...message, id });
  return {
    relay: relayed.answer,
    endpoint: (await response.json()) as unknown,
    status: response.status,
    relayDoorCalls,
    endpointDoorCalls: [...doorCalls],
  };
}

const call = (name: string, args?: unknown) => ({
  jsonrpc: '2.0',
  method: 'tools/call',
  params: { name, ...(args === undefined ? {} : { arguments: args }) },
});

describe('POST /api/connectors/mcp — the relay’s answers [CONN-R33]', () => {
  it.each([
    [
      'initialize',
      {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 't', version: '1' },
        },
      },
    ],
    ['initialize without a version', { jsonrpc: '2.0', method: 'initialize' }],
    ['tools/list', { jsonrpc: '2.0', method: 'tools/list' }],
    ['ping', { jsonrpc: '2.0', method: 'ping' }],
    ['an unknown method', { jsonrpc: '2.0', method: 'resources/list' }],
  ])('%s', async (_label, message) => {
    const result = await both(message);
    expect(result.status).toBe(200);
    expect(result.endpoint).toEqual(result.relay);
  });

  it.each([
    [
      'a connector call',
      call('connector', {
        slug: 'tavily',
        operation: 'search',
        args: { query: 'q' },
      }),
    ],
    [
      'a connector call without its operation',
      call('connector', { slug: 'tavily' }),
    ],
    [
      'a connector call whose args are no object',
      call('connector', { slug: 'tavily', operation: 'search', args: 'q' }),
    ],
    ['the connector status', call('connector_status', { ignored: true })],
    ['the workspace status', call('workspace_status', { ignored: true })],
    [
      'the workspace status inside the workspace tool',
      call('workspace_tool', { tool: 'workspace_status', args: { x: 1 } }),
    ],
    [
      'a workspace tool',
      call('workspace_tool', { tool: 'rag_search', args: { query: 'q' } }),
    ],
    ['a workspace tool without its name', call('workspace_tool', { args: {} })],
    ['a call without arguments', call('connector')],
    ['an unknown tool', call('shell', { cmd: 'id' })],
    [
      'a door that answers with an HTML page',
      call('connector', { slug: 'html', operation: 'x' }),
    ],
    ['a door that refuses', call('workspace_tool', { tool: 'refused' })],
    [
      'a door that reports a blocker',
      call('connector', { slug: 'unavailable', operation: 'x' }),
    ],
    [
      'a door past the bound',
      call('connector', { slug: 'slow', operation: 'x' }),
    ],
  ])('%s', async (_label, message) => {
    const result = await both(message);
    expect(result.status).toBe(200);
    expect(result.endpoint).toEqual(result.relay);
    expect(result.endpointDoorCalls).toEqual(result.relayDoorCalls);
    for (const doorCall of result.endpointDoorCalls) {
      expect(doorCall.authorization).toBe(`Bearer ${LIVE}`);
    }
  });

  it('reports progress on a long workspace tool, as the relay does, then answers', async () => {
    const message = {
      ...call('workspace_tool', {
        tool: 'generate_image',
        args: { prompt: 'p' },
      }),
      params: {
        name: 'workspace_tool',
        arguments: { tool: 'generate_image', args: { prompt: 'p' } },
        _meta: { progressToken: 'pt-1' },
      },
    };
    const relayed = await viaRelay({ ...message, id: 'long-relay' });
    const response = await viaEndpoint({ ...message, id: 'long-relay' });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const events = (await response.text())
      .split('\n\n')
      .filter((chunk) => chunk.startsWith('event: message\ndata: '))
      .map(
        (chunk) =>
          JSON.parse(chunk.slice('event: message\ndata: '.length)) as unknown,
      );
    const answerEvent = events.at(-1);
    expect(answerEvent).toEqual(relayed.answer);
    expect(events.slice(0, -1)).toEqual(
      relayed.progress.slice(0, events.length - 1),
    );
    expect(events.length - 1).toBeGreaterThanOrEqual(2);
  });

  it('answers a long call in one JSON body to a client that takes no stream', async () => {
    const response = await viaEndpoint(
      {
        jsonrpc: '2.0',
        id: 'long-json',
        method: 'tools/call',
        params: {
          name: 'workspace_tool',
          arguments: { tool: 'generate_image' },
          _meta: { progressToken: 'pt-2' },
        },
      },
      { accept: 'application/json' },
    );
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({
      id: 'long-json',
      result: { isError: false },
    });
  });
});

describe('POST /api/connectors/mcp — the session token [CONN-R34]', () => {
  it.each([
    ['no token', null],
    ['an empty token', ''],
    ['an unknown token', 'tok-unknown'],
  ])('refuses %s with 401 before anything runs', async (_label, token) => {
    const response = await viaEndpoint(call('connector_status'), { token });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Unauthorized.' },
    });
    expect(doorCalls).toEqual([]);
  });

  it('refuses a token that is not a bearer token', async () => {
    const response = await Promise.resolve(
      platform.request('/api/connectors/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${LIVE}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('refuses the token of a destroyed session (revoked) and an expired one, initialize included', async () => {
    tokenRows.set(
      sha256(LIVE),
      tokenRow('ses_live', { revokedAt: Date.now() - 1 }),
    );
    tokenRows.set(
      sha256(OTHER),
      tokenRow('ses_other', { expiresAt: Date.now() - 1 }),
    );
    for (const token of [LIVE, OTHER]) {
      for (const message of [
        { jsonrpc: '2.0', id: 1, method: 'initialize' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        call('connector', { slug: 'tavily', operation: 'search' }),
      ]) {
        const response = await viaEndpoint({ id: 3, ...message }, { token });
        expect(response.status).toBe(401);
      }
    }
    expect(doorCalls).toEqual([]);
  });

  it('carries each request’s own token to the doors, never another’s', async () => {
    await Promise.all([
      viaEndpoint(
        { ...call('connector', { slug: 'tavily', operation: 'a' }), id: 1 },
        { token: LIVE },
      ),
      viaEndpoint(
        { ...call('connector', { slug: 'tavily', operation: 'b' }), id: 2 },
        { token: OTHER },
      ),
      viaEndpoint(
        { ...call('workspace_tool', { tool: 'c' }), id: 3 },
        { token: OTHER },
      ),
    ]);
    const byCall = Object.fromEntries(
      doorCalls.map((doorCall) => {
        const body = doorCall.body as Record<string, unknown>;
        return [String(body.operation ?? body.tool), doorCall.authorization];
      }),
    );
    expect(byCall).toEqual({
      a: `Bearer ${LIVE}`,
      b: `Bearer ${OTHER}`,
      c: `Bearer ${OTHER}`,
    });
  });
});

describe('POST /api/connectors/mcp — the transport', () => {
  it('accepts a notification with 202 and no body', async () => {
    const response = await viaEndpoint({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('refuses a body that is not JSON, and a batch', async () => {
    const parse = await viaEndpoint('{not json');
    expect(parse.status).toBe(400);
    expect(await parse.json()).toMatchObject({ error: { code: -32700 } });
    const batch = await viaEndpoint([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
    ]);
    expect(batch.status).toBe(400);
    expect(await batch.json()).toMatchObject({ error: { code: -32600 } });
  });

  it('opens no stream and keeps no session: GET and DELETE answer 405', async () => {
    for (const method of ['GET', 'DELETE']) {
      const response = await viaEndpoint(undefined, { method });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
    const initialized = await viaEndpoint({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });
    expect(initialized.headers.get('mcp-session-id')).toBeNull();
  });
});
