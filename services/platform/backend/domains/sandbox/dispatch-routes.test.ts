// @vitest-environment node

/**
 * The tool door bypasses the proxy (backend-api is dual-homed onto the
 * sandbox network), so its request-body cap is the only size boundary
 * between a container and the shared API process. An oversized POST must
 * be refused with a 413 in the door's own tool-result dialect BEFORE the
 * body is parsed or the tool dispatched; a legitimate body must still reach
 * the dispatch intact — including when no Content-Length header lets the
 * cap decide up front and the stream has to be re-wrapped.
 *
 * The status door answers only from the server's side: the token row's
 * grants and this process's own build stamp, never anything else the request
 * says.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceToolStatusImpl } from '../../core/node_only/sandbox/workspace_tools_bridge.ts';
import { SANDBOX_DOOR_MAX_BODY_BYTES } from './door-body-limit.ts';

const { workspaceToolStatusImpl: listGrantedTools } = await vi.importActual<
  typeof import('../../core/node_only/sandbox/workspace_tools_bridge.ts')
>('../../core/node_only/sandbox/workspace_tools_bridge.ts');

const {
  dispatchWorkspaceToolImpl,
  getSessionTokenByHash,
  deferredEmbeddingMeter,
  resolveSessionOpAttribution,
} = vi.hoisted(() => ({
  dispatchWorkspaceToolImpl: vi.fn(),
  getSessionTokenByHash: vi.fn(),
  deferredEmbeddingMeter: vi.fn(() => ({
    open: vi.fn(),
    settle: vi.fn(),
    release: vi.fn(),
  })),
  resolveSessionOpAttribution: vi.fn(),
}));

vi.mock(
  '../../core/node_only/sandbox/workspace_tools_bridge.ts',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../core/node_only/sandbox/workspace_tools_bridge.ts')
      >();
    return {
      dispatchWorkspaceToolImpl,
      // The real listing, watched: the status door must answer it unchanged.
      workspaceToolStatusImpl: vi.fn(actual.workspaceToolStatusImpl),
    };
  },
);
vi.mock('../../lib/ctx-shim.ts', () => ({ createCtxShim: vi.fn(() => ({})) }));
vi.mock('./shim.ts', () => ({ sandboxToolShimHandlers: vi.fn(() => ({})) }));
vi.mock('./sessions.ts', () => ({ getSessionTokenByHash }));
vi.mock('../knowledge/embedding-meter.ts', () => ({ deferredEmbeddingMeter }));
vi.mock('./op-attribution.ts', () => ({ resolveSessionOpAttribution }));

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

describe('POST /api/tools/execute — the turn a token serves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatchWorkspaceToolImpl.mockResolvedValue({ status: 'ok', output: {} });
  });

  it('keeps discovery out of domain grants without disabling a granted task call [SBX-R6]', async () => {
    getSessionTokenByHash.mockResolvedValue({
      ...TOKEN_ROW,
      scope: { toolGrants: ['task_get'] },
    });
    const refused = await post(
      JSON.stringify({ tool: 'workspace_status', args: {} }),
    );
    expect(await refused.json()).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'not_granted' }],
    });
    expect(dispatchWorkspaceToolImpl).not.toHaveBeenCalled();

    const granted = await post(
      JSON.stringify({ tool: 'task_get', args: { taskId: 'task_1' } }),
    );
    expect(await granted.json()).toEqual({ status: 'ok', output: {} });
    expect(dispatchWorkspaceToolImpl).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({
        tool: 'task_get',
        callArgs: { taskId: 'task_1' },
      }),
    );
  });

  it('hands the token scope’s turnOp to the dispatch, never the body’s [SBX-R5]', async () => {
    getSessionTokenByHash.mockResolvedValue({
      ...TOKEN_ROW,
      scope: {
        toolGrants: ['generate_image'],
        turnOp: { kind: 'task-agent', execId: 'exec_token' },
      },
    });
    const res = await post(
      JSON.stringify({
        tool: 'generate_image',
        args: { prompt: 'a cat' },
        turnOp: { kind: 'task-agent', execId: 'exec_forged' },
      }),
    );
    expect(res.status).toBe(200);
    const [, call] = dispatchWorkspaceToolImpl.mock.calls[0] as [
      unknown,
      { turn?: unknown; callArgs: unknown },
    ];
    expect(call.turn).toEqual({ kind: 'task-agent', execId: 'exec_token' });
    expect(call.callArgs).toEqual({ prompt: 'a cat' });
  });

  it('passes no turn for a token that records none (or a malformed one)', async () => {
    getSessionTokenByHash.mockResolvedValue({
      ...TOKEN_ROW,
      scope: {
        toolGrants: ['generate_image'],
        turnOp: { kind: 'chat', execId: 'exec_1' },
      },
    });
    await post(JSON.stringify({ tool: 'generate_image', args: {} }));
    const [, call] = dispatchWorkspaceToolImpl.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(call).not.toHaveProperty('turn');
  });

  it('refuses generate_image when the token was not granted it [SBX-R6]', async () => {
    getSessionTokenByHash.mockResolvedValue(TOKEN_ROW);
    const res = await post(
      JSON.stringify({ tool: 'generate_image', args: { prompt: 'a cat' } }),
    );
    expect(await res.json()).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'not_granted' }],
    });
    expect(dispatchWorkspaceToolImpl).not.toHaveBeenCalled();
  });

  it('acts as the organization, session and person the token names, whatever the body claims [SBX-R5]', async () => {
    getSessionTokenByHash.mockResolvedValue(TOKEN_ROW);
    const res = await post(
      JSON.stringify({
        tool: 'document_find',
        args: {},
        organizationId: 'org_forged',
        sessionId: 'sess_forged',
        userId: 'user_forged',
        toolGrants: ['task_create'],
      }),
    );
    expect(res.status).toBe(200);
    const [, call] = dispatchWorkspaceToolImpl.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(call).toEqual({
      organizationId: 'org_1',
      sessionId: 'sess_1',
      userId: 'user_1',
      tool: 'document_find',
      callArgs: {},
      // A knowledge search's embedding is metered as the turn's spend.
      embeddingMeter: expect.objectContaining({ open: expect.any(Function) }),
    });
  });

  it('refuses a tool call without a live session token and dispatches nothing [SBX-R5]', async () => {
    getSessionTokenByHash.mockResolvedValue(null);
    const res = await post(JSON.stringify({ tool: 'document_find', args: {} }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      status: 'error',
      message: 'Unauthorized.',
    });
    expect(dispatchWorkspaceToolImpl).not.toHaveBeenCalled();
  });
});

describe('POST /api/tools/status — the serving platform version', () => {
  const SHA = 'ebf4546fb1455a236c1046f3d73ef78c2e1d0109';
  const NO_BUILD = "This backend's build carries no version label.";
  const DEV_BUILD =
    "This backend's build is labelled as a development build, not with a release version.";
  const NOT_A_RELEASE =
    "This backend's build is not labelled with a release version.";

  function postStatus(
    init: {
      path?: string;
      body?: string;
      headers?: Record<string, string>;
    } = {},
  ) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the routes never touch sql directly; every db seam is mocked
    const app = createToolDispatchRoutes({ sql: {} as Sql });
    return app.request(init.path ?? '/status', {
      method: 'POST',
      headers: init.headers ?? {
        authorization: 'Bearer vk-plaintext',
        'content-type': 'application/json',
      },
      body: init.body ?? '{}',
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TALE_VERSION', '0.5.64');
    getSessionTokenByHash.mockResolvedValue(TOKEN_ROW);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('adds the release beside the granted tools, which it lists unchanged [SBX-R6]', async () => {
    const grants = ['document_find', 'task_create'];
    getSessionTokenByHash.mockResolvedValue({
      ...TOKEN_ROW,
      scope: { ...TOKEN_ROW.scope, toolGrants: grants },
    });
    const listing = listGrantedTools(grants);
    expect(listing.tools.map((tool) => [tool.name, tool.readOnly])).toEqual([
      ['document_find', true],
      ['task_create', false],
    ]);

    const res = await postStatus();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...listing,
      platform: { version: '0.5.64' },
    });
    expect(workspaceToolStatusImpl).toHaveBeenCalledExactlyOnceWith(grants);
  });

  it('adds it beside the no-tools note when nothing is granted', async () => {
    for (const scope of [{ toolGrants: [] }, {}]) {
      getSessionTokenByHash.mockResolvedValue({ ...TOKEN_ROW, scope });
      const res = await postStatus();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        tools: [],
        note: 'No workspace tools are granted to this agent.',
        platform: { version: '0.5.64' },
      });
    }
  });

  it('refuses a caller without a live session token and discloses nothing [SBX-R5]', async () => {
    getSessionTokenByHash.mockResolvedValue(null);
    for (const authorization of [
      undefined,
      'Bearer ',
      'Basic dms6cGxhaW50ZXh0',
      'Bearer vk-revoked',
    ]) {
      const res = await postStatus({
        headers: {
          'content-type': 'application/json',
          ...(authorization !== undefined ? { authorization } : {}),
        },
      });
      expect(res.status).toBe(401);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({
        status: 'error',
        message: 'Unauthorized.',
      });
      expect(text).not.toContain('0.5.64');
    }
    expect(workspaceToolStatusImpl).not.toHaveBeenCalled();
  });

  it('reports its own build and grants, whatever the request claims [SBX-R5]', async () => {
    const baseline = await (await postStatus()).json();
    expect(baseline).toEqual({
      ...listGrantedTools(['document_find']),
      platform: { version: '0.5.64' },
    });

    const forged = await postStatus({
      path: '/status?version=9.9.9&platform=9.9.9',
      headers: {
        authorization: 'Bearer vk-plaintext',
        'content-type': 'application/json',
        'x-tale-version': '9.9.9',
      },
      body: JSON.stringify({
        platform: { version: '9.9.9' },
        version: '9.9.9',
        TALE_VERSION: '9.9.9',
        tools: [{ name: 'contact_find' }],
        toolGrants: ['contact_find'],
      }),
    });
    expect(forged.status).toBe(200);
    expect(await forged.json()).toEqual(baseline);
    // A body that is not even JSON is not read either.
    expect(await (await postStatus({ body: '{"platform":' })).json()).toEqual(
      baseline,
    );
    for (const call of vi.mocked(workspaceToolStatusImpl).mock.calls) {
      expect(call).toEqual([['document_find']]);
    }
  });

  it.each([
    [' 0.5.64\n', '0.5.64'],
    ['0.6.0-rc.1', '0.6.0-rc.1'],
  ])('reads the release label %j as %s', async (label, version) => {
    vi.stubEnv('TALE_VERSION', label);
    expect(await (await postStatus()).json()).toEqual({
      ...listGrantedTools(['document_find']),
      platform: { version },
    });
  });

  it.each<[string | undefined, string]>([
    [undefined, NO_BUILD],
    ['', NO_BUILD],
    ['   ', NO_BUILD],
    ['dev', DEV_BUILD],
    [`candidate-sha-${SHA}`, NOT_A_RELEASE],
    [`pr-3969-sha-${SHA}`, NOT_A_RELEASE],
    [`sha-${SHA}`, NOT_A_RELEASE],
    ['v0.5.64', NOT_A_RELEASE],
    ['0.5', NOT_A_RELEASE],
    ['latest', NOT_A_RELEASE],
  ])('confirms no release for the build label %j', async (label, note) => {
    vi.stubEnv('TALE_VERSION', label);
    const res = await postStatus();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      ...listGrantedTools(['document_find']),
      platform: { version: null, note },
    });
    // The label itself is never echoed: an image can be stamped with anything.
    expect(text).not.toContain(SHA);
  });
});

describe('POST /api/tools/execute — whose spend a search is', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatchWorkspaceToolImpl.mockResolvedValue({ status: 'ok', output: {} });
  });

  it('meters a knowledge search as the turn the token serves — its person, key and projects [GOV-R5]', async () => {
    getSessionTokenByHash.mockResolvedValue({
      ...TOKEN_ROW,
      scope: {
        ...TOKEN_ROW.scope,
        toolGrants: ['rag_search'],
        turnOp: { kind: 'task-agent', execId: 'exec_1' },
      },
    });
    resolveSessionOpAttribution.mockResolvedValue({
      userId: 'starter_1',
      agentSlug: 'support-agent',
      apiKeyId: 'key_1',
      projectIds: ['project_1'],
    });

    const res = await post(
      JSON.stringify({ tool: 'rag_search', args: { query: 'refunds' } }),
    );
    expect(res.status).toBe(200);

    const [, meterArgs] = deferredEmbeddingMeter.mock.calls[0] as unknown as [
      unknown,
      { organizationId: string; subject: () => Promise<unknown> },
    ];
    expect(meterArgs.organizationId).toBe('org_1');
    // Read only once a search actually embeds.
    expect(resolveSessionOpAttribution).not.toHaveBeenCalled();
    await expect(meterArgs.subject()).resolves.toEqual({
      userId: 'starter_1',
      agentSlug: '__embedding__',
      apiKeyId: 'key_1',
      projectIds: ['project_1'],
    });
    expect(resolveSessionOpAttribution).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'org_1',
        sessionId: 'sess_1',
        execId: 'exec_1',
        kind: 'task-agent',
      },
    );
  });
});
