// @vitest-environment node

/**
 * The connectors door bypasses the proxy like the tool door, so its
 * request-body cap is the only size boundary. `execute` speaks the
 * tool-result dialect (`{status, …}` relayed to the model); `hostcall`
 * speaks the façade's `{error: {code, message}}` — an in-sandbox
 * `ctx.http` call reads `error` to rethrow, so a `{status}` body there
 * would be misread as an HTTP status. Each door refuses in its own shape.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SANDBOX_DOOR_MAX_BODY_BYTES } from '../sandbox/door-body-limit.ts';

const {
  getSessionTokenByHash,
  runBridgeConnectorImpl,
  runConnectorAction,
  verifyHostcallToken,
} = vi.hoisted(() => ({
  getSessionTokenByHash: vi.fn(),
  runBridgeConnectorImpl: vi.fn(),
  runConnectorAction: vi.fn(),
  verifyHostcallToken: vi.fn(),
}));

vi.mock('../sandbox/sessions.ts', () => ({ getSessionTokenByHash }));
vi.mock('../../core/node_only/sandbox/connectors_bridge.ts', () => ({
  runBridgeConnectorImpl,
  bridgeConnectorStatusImpl: vi.fn(),
}));
vi.mock('./service.ts', () => ({ runConnectorAction }));
vi.mock('../connector_credentials/service.ts', () => ({
  resolveConnectorCredential: vi.fn(),
}));
vi.mock('../../core/connectors/hostcall_token.ts', () => ({
  verifyHostcallToken,
}));

const { createConnectorBridgeRoutes } = await import('./bridge-routes.ts');

function post(
  path: string,
  body: string,
  headers: Record<string, string> = {},
) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the audit insert is the only sql use, and no test reaches it
  const app = createConnectorBridgeRoutes({ sql: {} as Sql });
  return app.request(path, {
    method: 'POST',
    headers: {
      authorization: 'Bearer some-token',
      'content-type': 'application/json',
      ...headers,
    },
    body,
  });
}

const OVER_CAP = 'x'.repeat(SANDBOX_DOOR_MAX_BODY_BYTES + 1);

describe('POST /api/connectors/* — request-body cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionTokenByHash.mockResolvedValue({
      organizationId: 'org_1',
      sessionId: 'sess_1',
      scope: { connectorGrants: ['slack'], userId: 'user_1' },
      llmGatewayKeyId: null,
    });
    verifyHostcallToken.mockResolvedValue({
      ok: true,
      payload: { org: 'org_1', connector: 'slack', action: 'post' },
    });
  });

  it('execute: refuses an over-cap body with 413 in the tool-result dialect and never dispatches', async () => {
    const res = await post(
      '/execute',
      JSON.stringify({
        slug: 'slack',
        operation: 'post',
        args: { t: OVER_CAP },
      }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      status: 'invalid_args',
      message: expect.stringContaining('Request body too large'),
    });
    expect(runBridgeConnectorImpl).not.toHaveBeenCalled();
    expect(getSessionTokenByHash).not.toHaveBeenCalled();
  });

  it('hostcall: refuses an over-cap body with 413 in the façade error dialect', async () => {
    const res = await post(
      '/hostcall',
      JSON.stringify({
        kind: 'http',
        method: 'POST',
        url: 'https://slack.com/api/x',
        req: { body: OVER_CAP },
      }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: expect.stringContaining('Request body too large'),
      },
    });
    expect(verifyHostcallToken).not.toHaveBeenCalled();
  });

  it('status: a Content-Length over the cap is refused without reading the body', async () => {
    const res = await post('/status', '{}', {
      'content-length': String(SANDBOX_DOOR_MAX_BODY_BYTES + 1),
    });
    expect(res.status).toBe(413);
  });

  it('execute: a body under the cap reaches the dispatch intact', async () => {
    runBridgeConnectorImpl.mockResolvedValue({ status: 'ok', output: {} });
    const res = await post(
      '/execute',
      JSON.stringify({
        slug: 'slack',
        operation: 'post',
        args: { text: 'hi' },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', output: {} });
    const [, call] = runBridgeConnectorImpl.mock.calls[0] as [
      unknown,
      { slug: string; operation: string; callArgs: Record<string, unknown> },
    ];
    expect(call).toMatchObject({
      slug: 'slack',
      operation: 'post',
      callArgs: { text: 'hi' },
    });
  });
});
