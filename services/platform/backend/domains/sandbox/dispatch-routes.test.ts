// @vitest-environment node

/**
 * The tool door bypasses the proxy (backend-api is dual-homed onto the
 * sandbox network), so its request-body cap is the only size boundary
 * between a container and the shared API process. An oversized POST must
 * be refused with a 413 in the door's own tool-result dialect BEFORE the
 * body is parsed or the tool dispatched; a legitimate body must still reach
 * the dispatch intact — including when no Content-Length header lets the
 * cap decide up front and the stream has to be re-wrapped.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SANDBOX_DOOR_MAX_BODY_BYTES } from './door-body-limit.ts';

const { dispatchWorkspaceToolImpl, getSessionTokenByHash } = vi.hoisted(() => ({
  dispatchWorkspaceToolImpl: vi.fn(),
  getSessionTokenByHash: vi.fn(),
}));

vi.mock('../../core/node_only/sandbox/workspace_tools_bridge.ts', () => ({
  dispatchWorkspaceToolImpl,
  workspaceToolStatusImpl: vi.fn(() => ({ status: 'ok', tools: [] })),
}));
vi.mock('../../lib/ctx-shim.ts', () => ({ createCtxShim: vi.fn(() => ({})) }));
vi.mock('./shim.ts', () => ({ sandboxToolShimHandlers: vi.fn(() => ({})) }));
vi.mock('./sessions.ts', () => ({ getSessionTokenByHash }));

const { createToolDispatchRoutes } = await import('./dispatch-routes.ts');

const TOKEN_ROW = {
  organizationId: 'org_1',
  sessionId: 'sess_1',
  scope: { toolGrants: ['document_find'], userId: 'user_1' },
  llmGatewayKeyId: null,
};

function post(body: string, headers: Record<string, string> = {}) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the routes never touch sql directly; every db seam is mocked
  const app = createToolDispatchRoutes({ sql: {} as Sql });
  return app.request('/execute', {
    method: 'POST',
    headers: {
      authorization: 'Bearer vk-plaintext',
      'content-type': 'application/json',
      ...headers,
    },
    body,
  });
}

describe('POST /api/tools/execute — request-body cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionTokenByHash.mockResolvedValue(TOKEN_ROW);
    dispatchWorkspaceToolImpl.mockResolvedValue({ status: 'ok', output: {} });
  });

  it('refuses an over-cap body with 413 in the tool-result dialect and never dispatches', async () => {
    const filler = 'x'.repeat(SANDBOX_DOOR_MAX_BODY_BYTES + 1);
    const res = await post(
      JSON.stringify({ tool: 'document_find', args: { fileName: filler } }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      status: 'invalid_args',
      message: expect.stringContaining('Request body too large'),
    });
    expect(dispatchWorkspaceToolImpl).not.toHaveBeenCalled();
  });

  it('decides from Content-Length when the header is present, without reading the body', async () => {
    const res = await post(
      JSON.stringify({ tool: 'document_find', args: {} }),
      {
        'content-length': String(SANDBOX_DOOR_MAX_BODY_BYTES + 1),
      },
    );
    expect(res.status).toBe(413);
    expect(dispatchWorkspaceToolImpl).not.toHaveBeenCalled();
  });

  it('passes a body under the cap through to the dispatch intact', async () => {
    const res = await post(
      JSON.stringify({ tool: 'document_find', args: { extension: 'pdf' } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', output: {} });
    expect(dispatchWorkspaceToolImpl).toHaveBeenCalledTimes(1);
    const [, call] = dispatchWorkspaceToolImpl.mock.calls[0] as [
      unknown,
      {
        tool: string;
        callArgs: Record<string, unknown>;
        organizationId: string;
      },
    ];
    expect(call.tool).toBe('document_find');
    expect(call.callArgs).toEqual({ extension: 'pdf' });
    expect(call.organizationId).toBe('org_1');
  });

  it('still answers the auth refusal for an oversized body with no session token', async () => {
    // The cap runs first: an anonymous flood must not even reach the token
    // lookup, but the answer stays a refusal either way.
    getSessionTokenByHash.mockResolvedValue(null);
    const res = await post('x'.repeat(SANDBOX_DOOR_MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    expect(getSessionTokenByHash).not.toHaveBeenCalled();
  });
});
