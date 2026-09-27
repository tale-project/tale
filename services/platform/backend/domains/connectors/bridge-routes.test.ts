// @vitest-environment node

/**
 * The connectors door bypasses the proxy like the tool door, so its
 * request-body cap is the only size boundary. `execute` speaks the
 * tool-result dialect (`{status, …}` relayed to the model); `hostcall`
 * speaks the façade's `{error: {code, message}}` — an in-sandbox
 * `ctx.http` call reads `error` to rethrow, so a `{status}` body there
 * would be misread as an HTTP status. Each door refuses in its own shape.
 *
 * The second half pins WHOM a call acts for: the token's own user, or the
 * member a run-scoped turn was provisioned to act for (`connectorCaller`, a
 * task run's starter), and only while that person is still an active member.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SANDBOX_DOOR_MAX_BODY_BYTES } from '../sandbox/door-body-limit.ts';

const {
  bridgeConnectorStatusImpl,
  getSessionTokenByHash,
  resolveConnectorCredential,
  runBridgeConnectorImpl,
  runConnectorAction,
  verifyHostcallToken,
} = vi.hoisted(() => ({
  bridgeConnectorStatusImpl: vi.fn(),
  getSessionTokenByHash: vi.fn(),
  resolveConnectorCredential: vi.fn(),
  runBridgeConnectorImpl: vi.fn(),
  runConnectorAction: vi.fn(),
  verifyHostcallToken: vi.fn(),
}));

vi.mock('../sandbox/sessions.ts', () => ({ getSessionTokenByHash }));
vi.mock(
  '../../core/node_only/sandbox/connectors_bridge.ts',
  async (importActual) => ({
    ...(await importActual<
      typeof import('../../core/node_only/sandbox/connectors_bridge.ts')
    >()),
    runBridgeConnectorImpl,
    bridgeConnectorStatusImpl,
  }),
);
vi.mock('./service.ts', () => ({ runConnectorAction }));
vi.mock('../connector_credentials/service.ts', () => ({
  resolveConnectorCredential,
}));
vi.mock('../../core/connectors/hostcall_token.ts', () => ({
  verifyHostcallToken,
}));

const { createConnectorBridgeRoutes } = await import('./bridge-routes.ts');
const bridgeDecisions = await vi.importActual<
  typeof import('../../core/node_only/sandbox/connectors_bridge.ts')
>('../../core/node_only/sandbox/connectors_bridge.ts');

/** Members of `org_1` who may still be acted for. */
let activeMembers = new Set<string>();
/** Every query the route sent, and the forensic rows it wrote. */
let queries: string[] = [];
let toolCalls: unknown[][] = [];

/** postgres.js as far as the route uses it: the membership read and the
 * forensic insert. */
const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('?');
  queries.push(text);
  if (text.includes('FROM "member"')) {
    const [organizationId, userId] = values;
    return Promise.resolve(
      organizationId === 'org_1' &&
        typeof userId === 'string' &&
        activeMembers.has(userId)
        ? [{ userId }]
        : [],
    );
  }
  if (text.includes('INSERT INTO app.sandbox_tool_calls')) {
    toolCalls.push(values);
    return Promise.resolve([]);
  }
  throw new Error(`unexpected query: ${text}`);
}) as unknown as Sql;

function post(
  path: string,
  body: string,
  headers: Record<string, string> = {},
) {
  const app = createConnectorBridgeRoutes({ sql });
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

beforeEach(() => {
  vi.clearAllMocks();
  activeMembers = new Set(['user_1']);
  queries = [];
  toolCalls = [];
});

describe('POST /api/connectors/* — request-body cap', () => {
  beforeEach(() => {
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

/** A live token row whose scope is `scope` (every other field is fixed). */
function tokenWith(scope: Record<string, unknown>) {
  getSessionTokenByHash.mockResolvedValue({
    organizationId: 'org_1',
    sessionId: 'pa-agent_1',
    scope: {
      agentKind: 'claude-code',
      allowedModels: [],
      budgetCents: 500,
      connectorGrants: ['glitchtip'],
      ...scope,
    },
    llmGatewayKeyId: null,
  });
}

const LIST_ISSUES = JSON.stringify({
  slug: 'glitchtip',
  operation: 'list_import_issues',
  args: { organizationSlug: 'tale' },
});

async function refusal(res: Response) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the refusal shape is the route's own
  return (await res.json()) as {
    status: string;
    blockers: Array<{ code: string; guidance: string }>;
  };
}

describe('POST /api/connectors/execute — whom a call acts for', () => {
  beforeEach(() => {
    // The real decision body: it validates the call and hands it to the
    // connector door, where the caller lands.
    runBridgeConnectorImpl.mockImplementation(
      bridgeDecisions.runBridgeConnectorImpl,
    );
    runConnectorAction.mockResolvedValue({ status: 'ok', output: [] });
    activeMembers = new Set(['user_starter', 'user_1']);
  });

  it('runs a task turn’s call for the member it was provisioned to act for', async () => {
    tokenWith({ connectorCaller: { kind: 'user', userId: 'user_starter' } });

    const res = await post('/execute', LIST_ISSUES);

    expect(await res.json()).toEqual({ status: 'ok', output: [] });
    expect(runConnectorAction.mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'org_1',
      connector: 'glitchtip',
      action: 'list_import_issues',
      caller: { kind: 'user', userId: 'user_starter' },
      execSessionId: 'pa-agent_1',
    });
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toContain('user_starter');
  });

  it('runs a user-keyed token’s call for its own user', async () => {
    tokenWith({ userId: 'user_1' });

    const res = await post('/execute', LIST_ISSUES);

    expect(await res.json()).toMatchObject({ status: 'ok' });
    expect(runConnectorAction.mock.calls[0]?.[1]).toMatchObject({
      caller: { kind: 'user', userId: 'user_1' },
    });
  });

  it('refuses a task run that acts for nobody, naming how to start one that does', async () => {
    tokenWith({ connectorCaller: { kind: 'nobody', opKind: 'task-agent' } });

    const body = await refusal(await post('/execute', LIST_ISSUES));

    expect(body.status).toBe('unavailable');
    expect(body.blockers).toHaveLength(1);
    expect(body.blockers[0]?.code).toBe('no_user_context');
    expect(body.blockers[0]?.guidance).toContain('task run');
    expect(body.blockers[0]?.guidance).toContain('Start agent');
    expect(runConnectorAction).not.toHaveBeenCalled();
    // Refused at the door: nobody to record, nothing ran.
    expect(toolCalls).toEqual([]);
  });

  it.each([
    ['records no caller', {}],
    [
      'records a caller this image cannot read',
      { connectorCaller: { kind: 'system' } },
    ],
    [
      'names a caller with no user',
      { connectorCaller: { kind: 'user', userId: '' } },
    ],
  ])(
    'refuses a token that %s, with both lanes’ remedies',
    async (_label, scope) => {
      tokenWith(scope);

      const body = await refusal(await post('/execute', LIST_ISSUES));

      expect(body).toMatchObject({
        status: 'unavailable',
        blockers: [{ code: 'no_user_context' }],
      });
      expect(body.blockers[0]?.guidance).toContain('connector node');
      expect(body.blockers[0]?.guidance).toContain('task run');
      expect(runConnectorAction).not.toHaveBeenCalled();
    },
  );

  it('refuses a caller who is no longer an active member of the organization', async () => {
    tokenWith({ connectorCaller: { kind: 'user', userId: 'user_gone' } });

    const body = await refusal(await post('/execute', LIST_ISSUES));

    expect(body).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'access_denied' }],
    });
    expect(body.blockers[0]?.guidance).toContain('no longer an active member');
    expect(runConnectorAction).not.toHaveBeenCalled();
    expect(toolCalls).toEqual([]);
  });

  it('checks the grant first, as before, before looking at the caller', async () => {
    tokenWith({ connectorCaller: { kind: 'nobody', opKind: 'task-agent' } });

    const body = await refusal(
      await post(
        '/execute',
        JSON.stringify({ slug: 'github', operation: 'list_issues' }),
      ),
    );

    expect(body.blockers[0]?.code).toBe('not_granted');
    expect(queries.some((text) => text.includes('FROM "member"'))).toBe(false);
  });
});

describe('POST /api/connectors/status — whom a call acts for', () => {
  beforeEach(() => {
    bridgeConnectorStatusImpl.mockImplementation(
      bridgeDecisions.bridgeConnectorStatusImpl,
    );
    resolveConnectorCredential.mockResolvedValue({ credentialId: 'cred_1' });
    activeMembers = new Set(['user_starter']);
  });

  it('lists an equipped connector as usable for an active member', async () => {
    tokenWith({ connectorCaller: { kind: 'user', userId: 'user_starter' } });

    const res = await post('/status', '{}');

    expect(await res.json()).toMatchObject({
      connectors: [{ slug: 'glitchtip', usable: true, blockers: [] }],
    });
  });

  it('reports the caller refusal on every connector a turn that acts for nobody holds', async () => {
    tokenWith({
      connectorCaller: { kind: 'nobody', opKind: 'task-agent' },
      connectorGrants: ['glitchtip', 'not-shipped'],
    });

    const res = await post('/status', '{}');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the listing shape is the decision body's own
    const body = (await res.json()) as {
      connectors: Array<{
        slug: string;
        usable: boolean;
        blockers: Array<{ code: string }>;
      }>;
    };

    expect(body.connectors).toEqual([
      expect.objectContaining({
        slug: 'glitchtip',
        usable: false,
        blockers: [expect.objectContaining({ code: 'no_user_context' })],
      }),
      // A connector that does not ship says only that.
      expect.objectContaining({
        slug: 'not-shipped',
        usable: false,
        blockers: [expect.objectContaining({ code: 'unknown_connector' })],
      }),
    ]);
  });

  it('reports a caller who left the organization', async () => {
    tokenWith({ connectorCaller: { kind: 'user', userId: 'user_gone' } });

    const res = await post('/status', '{}');

    expect(await res.json()).toMatchObject({
      connectors: [
        {
          slug: 'glitchtip',
          usable: false,
          blockers: [{ code: 'access_denied' }],
        },
      ],
    });
  });

  it('reads no membership when nothing is equipped', async () => {
    tokenWith({ connectorGrants: [] });

    const res = await post('/status', '{}');

    expect(await res.json()).toMatchObject({ connectors: [] });
    expect(queries).toEqual([]);
  });
});
