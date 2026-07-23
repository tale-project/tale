import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { setCodeRunner, type CodeRunner } from '../engine/core/runner';
import { nodeVmRunner } from '../engine/runners/node-vm';
import {
  integrationConnectorSchema,
  type IntegrationConnector,
} from '../shared/schemas/integrations';
import {
  executeIntegrationAction,
  installConnectorCatalog,
  loadConnectorCatalog,
  registerNativeImpl,
  type ApprovalGate,
  type CredentialResolver,
  type IntegrationAuditSink,
  type IntegrationInvocationRecord,
  type NativeIntegrationContext,
} from './dispatcher';
import { INTEGRATION_CODES, IntegrationError } from './errors';

/**
 * The dispatcher is the only door into a connector, so these tests are about
 * what it refuses: an input that does not match the schema, a live call with
 * no credential resolver, a native backend nobody registered, a user-initiated
 * write with no approvals gate, and a system call that cannot be recorded.
 *
 * Nothing here touches the network. `fetch` is stubbed globally, and the
 * assertions that matter most are the ones proving it was never called.
 */

const SYSTEM_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../configs/platform/system',
);

/**
 * A CodeRunner that can hand a live body the host's capability functions.
 *
 * The bundled node-vm runner is data-only by contract — a scope crosses it as
 * JSON — so it can run a mock body but cannot give a live body `ctx.http`.
 * Live execution therefore needs a backend able to proxy host capabilities;
 * this test double is the smallest thing with that property (it is emphatically
 * NOT a sandbox: the body is compiled in this realm).
 */
function liveCapableRunner(): CodeRunner {
  const base = nodeVmRunner();
  return {
    ...base,
    runBody: async (code, scope, limits, opts) => {
      if (opts?.async !== true) return base.runBody(code, scope, limits, opts);
      const body = vm.runInThisContext(
        `(async function (input, ctx) {\n${code}\n})`,
      ) as (input: unknown, ctx: unknown) => Promise<unknown>;
      return body(scope.input, scope.ctx);
    },
  };
}

/** A connector that exists only here, so the dispatch rules can be exercised
 * without depending on any shipped vendor's shape. */
const DEMO: IntegrationConnector = integrationConnectorSchema.parse({
  name: 'demo',
  displayName: 'Demo',
  description: 'A connector used by the dispatcher tests.',
  endpointMode: 'fixed',
  allowedHosts: ['api.demo.test'],
  auth: [{ method: 'bearer' }],
  actions: [
    {
      name: 'echo',
      description: 'Echo a message back.',
      effects: 'read',
      input: {
        type: 'object',
        required: ['message'],
        properties: { message: { type: 'string' } },
      },
      output: '{ echoed: string }',
      mock: 'return { echoed: input.message, mocked: true };',
      backend: {
        kind: 'yaml-js',
        live: [
          "const r = await ctx.http.get('https://api.demo.test/echo?m=' + encodeURIComponent(input.message));",
          'return { echoed: r.json().echoed, status: r.status, token: ctx.secrets.get("token"), key: ctx.idempotencyKey };',
        ].join('\n'),
      },
    },
    {
      name: 'send',
      description: 'Send a message somewhere.',
      effects: 'write',
      input: {
        type: 'object',
        required: ['message'],
        properties: { message: { type: 'string' } },
      },
      output: '{ sent: string }',
      mock: 'return { sent: input.message, mocked: true };',
      backend: { kind: 'yaml-js', live: 'return { sent: input.message };' },
    },
    {
      name: 'explode',
      description: 'A live body that always fails.',
      effects: 'write',
      input: { type: 'object', properties: {} },
      output: '{ never: string }',
      mock: 'return { never: "reached" };',
      backend: {
        kind: 'yaml-js',
        live: 'throw new Error("vendor said no");',
      },
    },
    {
      name: 'mock_only',
      description: 'An action with no live backend at all.',
      effects: 'read',
      input: { type: 'object', properties: {} },
      output: '{ ok: boolean }',
      mock: 'return { ok: true };',
    },
    {
      name: 'bad_mock',
      description: 'An action whose mock body is broken.',
      effects: 'read',
      input: { type: 'object', properties: {} },
      output: '{ never: string }',
      mock: 'throw new Error("mock is broken");',
    },
    {
      name: 'native_send',
      description: 'An action whose live half is a platform module.',
      effects: 'write',
      input: {
        type: 'object',
        required: ['to'],
        properties: { to: { type: 'string' } },
      },
      output: '{ messageId: string }',
      mock: 'return { messageId: "mock-native" };',
      backend: { kind: 'native', impl: 'demo.native_send' },
    },
  ],
});

const ORG = 'org_test_1';

function resolver(
  overrides: Partial<Awaited<ReturnType<CredentialResolver['resolve']>>> = {},
): CredentialResolver & { calls: Array<[string, string, string | undefined]> } {
  const calls: Array<[string, string, string | undefined]> = [];
  return {
    calls,
    resolve: async (orgId, connectorSlug, ref) => {
      calls.push([orgId, connectorSlug, ref]);
      return {
        credentialId: 'cred_1',
        authMethod: 'bearer',
        secrets: { token: 'sekrit' },
        authHeader: 'Bearer resolved-token',
        ...overrides,
      };
    },
  };
}

function auditSink(): IntegrationAuditSink & {
  records: IntegrationInvocationRecord[];
} {
  const records: IntegrationInvocationRecord[] = [];
  return {
    records,
    record: async (entry) => {
      records.push(entry);
    },
  };
}

function gate(decision: 'allowed' | 'required'): ApprovalGate & {
  calls: number;
} {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    check: async () => {
      state.calls++;
      return decision === 'allowed'
        ? { status: 'allowed' }
        : {
            status: 'required',
            approvalId: 'appr_1',
            message: 'needs a human',
          };
    },
  };
}

let fetchStub: ReturnType<typeof vi.fn>;
let shipped: IntegrationConnector[];

beforeAll(() => {
  setCodeRunner(liveCapableRunner());
  shipped = loadConnectorCatalog(SYSTEM_ROOT);
});

beforeEach(() => {
  vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '');
  installConnectorCatalog([...shipped, DEMO]);
  fetchStub = vi.fn(
    async () =>
      new Response(JSON.stringify({ echoed: 'from the vendor' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('resolution', () => {
  it('loads every shipped connector into the catalog', () => {
    expect(shipped.length).toBe(13);
  });

  it('names a near-miss connector', async () => {
    await expect(
      executeIntegrationAction({
        connector: 'githu',
        action: 'create_issue',
        input: {},
        caller: { kind: 'user', userId: 'u1' },
        ctx: { organizationId: ORG },
      }),
    ).rejects.toMatchObject({
      code: 'UNKNOWN_CONNECTOR',
      hint: 'did you mean "github"?',
    });
  });

  it('names a near-miss action', async () => {
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'ech',
        input: { message: 'hi' },
        caller: { kind: 'user', userId: 'u1' },
        ctx: { organizationId: ORG },
      }),
    ).rejects.toMatchObject({
      code: 'UNKNOWN_ACTION',
      hint: 'did you mean "echo"?',
    });
  });

  it('refuses to dispatch with no catalog installed', async () => {
    installConnectorCatalog([]);
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'echo',
        input: { message: 'hi' },
        caller: { kind: 'user', userId: 'u1' },
        ctx: { organizationId: ORG },
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
  });

  it('requires an organization on every invocation', async () => {
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'echo',
        input: { message: 'hi' },
        caller: { kind: 'user', userId: 'u1' },
        ctx: { organizationId: '' },
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_REQUIRED' });
  });
});

describe('input validation', () => {
  it('refuses input that fails the action schema before anything happens', async () => {
    const credentials = resolver();
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'echo',
        input: { message: 42 },
        caller: { kind: 'user', userId: 'u1' },
        ctx: { organizationId: ORG, mode: 'live', credentials },
      }),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    // Nothing was resolved and nothing left the process.
    expect(credentials.calls).toHaveLength(0);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('refuses a missing required field', async () => {
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'echo',
        input: {},
        caller: { kind: 'user', userId: 'u1' },
        ctx: { organizationId: ORG, mode: 'live', credentials: resolver() },
      }),
    ).rejects.toThrow(/must have required property/);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe('mock mode', () => {
  it('runs the deterministic mock body and performs no IO', async () => {
    const credentials = resolver();
    const result = await executeIntegrationAction({
      connector: 'demo',
      action: 'echo',
      input: { message: 'hello' },
      caller: { kind: 'user', userId: 'u1' },
      ctx: { organizationId: ORG, credentials },
    });
    expect(result).toMatchObject({
      status: 'ok',
      backend: 'mock',
      mode: 'mock',
      nodeType: 'demo.echo',
      output: { echoed: 'hello', mocked: true },
    });
    expect(fetchStub).not.toHaveBeenCalled();
    expect(credentials.calls).toHaveLength(0);
  });

  it('mocks a write action without an approvals gate — nothing happens', async () => {
    const result = await executeIntegrationAction({
      connector: 'demo',
      action: 'send',
      input: { message: 'hi' },
      caller: { kind: 'user', userId: 'u1' },
      ctx: { organizationId: ORG },
    });
    expect(result).toMatchObject({ status: 'ok', backend: 'mock' });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('reports a broken mock body under its own code', async () => {
    const error: unknown = await executeIntegrationAction({
      connector: 'demo',
      action: 'bad_mock',
      input: {},
      caller: { kind: 'user', userId: 'u1' },
      ctx: { organizationId: ORG },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrationError);
    const coded = error as IntegrationError;
    // Every refusal names a code from the catalog, and renders with the
    // capability it happened under.
    expect(INTEGRATION_CODES[coded.code]).toBeTypeOf('string');
    expect(coded.code).toBe('MOCK_BODY_FAILED');
    expect(coded.describe()).toContain('(demo.bad_mock)');
  });

  it('runs a shipped connector mock through the same door', async () => {
    const result = await executeIntegrationAction({
      connector: 'github',
      action: 'create_issue',
      input: { owner: 'tale', repo: 'tale', title: 'Bug report' },
      caller: { kind: 'user', userId: 'u1' },
      ctx: { organizationId: ORG },
    });
    expect(result.status).toBe('ok');
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe('live yaml-js backend', () => {
  it('runs the live body against the mediated host', async () => {
    const credentials = resolver();
    const result = await executeIntegrationAction({
      connector: 'demo',
      action: 'echo',
      input: { message: 'hello' },
      credentialRef: 'primary',
      caller: { kind: 'user', userId: 'u1' },
      ctx: { organizationId: ORG, mode: 'live', credentials },
    });
    expect(result).toMatchObject({
      status: 'ok',
      backend: 'yaml-js',
      mode: 'live',
      credentialId: 'cred_1',
    });
    expect(result.status === 'ok' && result.output).toMatchObject({
      echoed: 'from the vendor',
      status: 200,
      // Secrets reach the body; the Authorization token never does.
      token: 'sekrit',
    });
    // The credential is resolved for THIS org and connector, honouring the ref.
    expect(credentials.calls).toEqual([[ORG, 'demo', 'primary']]);
    const [, init] = fetchStub.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer resolved-token');
  });

  it('derives a retry-stable idempotency key and lets a caller override it', async () => {
    const run = (idempotencyKey?: string) =>
      executeIntegrationAction({
        connector: 'demo',
        action: 'echo',
        input: { message: 'hello' },
        caller: { kind: 'workflow', runId: 'run_1', nodeId: 'n1' },
        ctx: {
          organizationId: ORG,
          mode: 'live',
          credentials: resolver(),
          ...(idempotencyKey !== undefined && { idempotencyKey }),
        },
      });
    const first = await run();
    const second = await run();
    const keyOf = (r: Awaited<ReturnType<typeof run>>) =>
      r.status === 'ok' && typeof r.output === 'object' && r.output !== null
        ? Reflect.get(r.output, 'key')
        : undefined;
    expect(keyOf(first)).toBe(keyOf(second));
    expect(keyOf(await run('run_1:n1:0'))).toBe('run_1:n1:0');
  });

  it('reports a failing live body as a coded error, not as output', async () => {
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'explode',
        input: {},
        caller: { kind: 'system', reason: 'test' },
        ctx: {
          organizationId: ORG,
          mode: 'live',
          credentials: resolver(),
          audit: auditSink(),
        },
      }),
    ).rejects.toMatchObject({ code: 'LIVE_BODY_FAILED' });
  });

  it('refuses a live call for a mock-only action instead of mocking it', async () => {
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'mock_only',
        input: {},
        caller: { kind: 'user', userId: 'u1' },
        ctx: { organizationId: ORG, mode: 'live', credentials: resolver() },
      }),
    ).rejects.toMatchObject({ code: 'NO_LIVE_BACKEND' });
  });
});

describe('native backends', () => {
  it('fails loudly when the declared native impl is not registered', async () => {
    const promise = executeIntegrationAction({
      connector: 'demo',
      action: 'native_send',
      input: { to: 'someone@example.com' },
      caller: { kind: 'system', reason: 'conversation email reply' },
      ctx: {
        organizationId: ORG,
        mode: 'live',
        credentials: resolver(),
        audit: auditSink(),
      },
    });
    // Emphatically NOT the mock's `{ messageId: 'mock-native' }`.
    await expect(promise).rejects.toMatchObject({
      code: 'NATIVE_IMPL_UNAVAILABLE',
    });
    await expect(promise).rejects.toThrow(/not available in this deployment/);
  });

  it('fails loudly for a shipped native connector that is not wired yet', async () => {
    await expect(
      executeIntegrationAction({
        connector: 'imap-smtp',
        action: 'send',
        input: { to: 'someone@example.com', subject: 'Hi' },
        caller: { kind: 'system', reason: 'conversation email reply' },
        ctx: {
          organizationId: ORG,
          mode: 'live',
          credentials: resolver(),
          audit: auditSink(),
        },
      }),
    ).rejects.toMatchObject({ code: 'NATIVE_IMPL_UNAVAILABLE' });
  });

  it('calls a registered impl with the org and the mediated context', async () => {
    const seen: Array<{ input: unknown; ctx: NativeIntegrationContext }> = [];
    const dispose = registerNativeImpl(
      'demo.native_send',
      async (input, ctx) => {
        seen.push({ input, ctx });
        return { messageId: 'native-1' };
      },
    );
    try {
      const result = await executeIntegrationAction({
        connector: 'demo',
        action: 'native_send',
        input: { to: 'someone@example.com' },
        caller: { kind: 'system', reason: 'conversation email reply' },
        ctx: {
          organizationId: ORG,
          mode: 'live',
          credentials: resolver(),
          audit: auditSink(),
        },
      });
      expect(result).toMatchObject({
        status: 'ok',
        backend: 'native',
        output: { messageId: 'native-1' },
      });
      expect(seen[0].ctx.organizationId).toBe(ORG);
      expect(seen[0].ctx.credentialId).toBe('cred_1');
      expect(seen[0].ctx.authMethod).toBe('bearer');
      expect(seen[0].ctx.secrets.get('token')).toBe('sekrit');
      expect(typeof seen[0].ctx.http.get).toBe('function');
    } finally {
      dispose();
    }
    // The disposer really removes it.
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'native_send',
        input: { to: 'someone@example.com' },
        caller: { kind: 'system', reason: 'conversation email reply' },
        ctx: {
          organizationId: ORG,
          mode: 'live',
          credentials: resolver(),
          audit: auditSink(),
        },
      }),
    ).rejects.toMatchObject({ code: 'NATIVE_IMPL_UNAVAILABLE' });
  });
});

describe('caller modes', () => {
  it('gates a user-initiated write behind approvals', async () => {
    const approvals = gate('required');
    const credentials = resolver();
    const result = await executeIntegrationAction({
      connector: 'demo',
      action: 'send',
      input: { message: 'hi' },
      caller: { kind: 'user', userId: 'u1' },
      ctx: { organizationId: ORG, mode: 'live', credentials, approvals },
    });
    expect(result).toMatchObject({
      status: 'approval-required',
      approvalId: 'appr_1',
      message: 'needs a human',
    });
    expect(approvals.calls).toBe(1);
    // Nothing was resolved and nothing was sent.
    expect(credentials.calls).toHaveLength(0);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('runs a user-initiated write once approvals allow it', async () => {
    const approvals = gate('allowed');
    const result = await executeIntegrationAction({
      connector: 'demo',
      action: 'send',
      input: { message: 'hi' },
      caller: { kind: 'user', userId: 'u1' },
      ctx: {
        organizationId: ORG,
        mode: 'live',
        credentials: resolver(),
        approvals,
      },
    });
    expect(result).toMatchObject({ status: 'ok', output: { sent: 'hi' } });
    expect(approvals.calls).toBe(1);
  });

  it('does not gate a user-initiated READ', async () => {
    const approvals = gate('required');
    const result = await executeIntegrationAction({
      connector: 'demo',
      action: 'echo',
      input: { message: 'hello' },
      caller: { kind: 'user', userId: 'u1' },
      ctx: {
        organizationId: ORG,
        mode: 'live',
        credentials: resolver(),
        approvals,
      },
    });
    expect(result.status).toBe('ok');
    expect(approvals.calls).toBe(0);
  });

  it('refuses a user-initiated write when no gate was supplied', async () => {
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'send',
        input: { message: 'hi' },
        caller: { kind: 'user', userId: 'u1' },
        ctx: { organizationId: ORG, mode: 'live', credentials: resolver() },
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_GATE_MISSING' });
  });

  it('lets the system caller skip approvals — and records why', async () => {
    const approvals = gate('required');
    const audit = auditSink();
    const result = await executeIntegrationAction({
      connector: 'demo',
      action: 'send',
      input: { message: 'your ticket was updated' },
      caller: { kind: 'system', reason: 'conversation email reply' },
      ctx: {
        organizationId: ORG,
        mode: 'live',
        credentials: resolver(),
        approvals,
        audit,
      },
    });
    expect(result.status).toBe('ok');
    // The gate exists and is deliberately not consulted.
    expect(approvals.calls).toBe(0);
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0]).toMatchObject({
      organizationId: ORG,
      nodeType: 'demo.send',
      callerKind: 'system',
      reason: 'conversation email reply',
      effects: 'write',
      mode: 'live',
      outcome: 'ok',
      credentialId: 'cred_1',
    });
  });

  it('refuses a system call that cannot be recorded', async () => {
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'send',
        input: { message: 'hi' },
        caller: { kind: 'system', reason: 'actionable notification' },
        ctx: { organizationId: ORG, mode: 'live', credentials: resolver() },
      }),
    ).rejects.toMatchObject({ code: 'AUDIT_SINK_MISSING' });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('refuses a system call with no stated reason', async () => {
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'send',
        input: { message: 'hi' },
        caller: { kind: 'system', reason: '  ' },
        ctx: {
          organizationId: ORG,
          mode: 'live',
          credentials: resolver(),
          audit: auditSink(),
        },
      }),
    ).rejects.toMatchObject({ code: 'SYSTEM_REASON_REQUIRED' });
  });

  it('fails a system call whose record could not be written', async () => {
    const audit: IntegrationAuditSink = {
      record: async () => {
        throw new Error('audit store unreachable');
      },
    };
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'send',
        input: { message: 'hi' },
        caller: { kind: 'system', reason: 'actionable notification' },
        ctx: {
          organizationId: ORG,
          mode: 'live',
          credentials: resolver(),
          audit,
        },
      }),
    ).rejects.toMatchObject({ code: 'AUDIT_FAILED' });
  });

  it('leaves approvals and effects to the executor for the workflow caller', async () => {
    const approvals = gate('required');
    const audit = auditSink();
    const result = await executeIntegrationAction({
      connector: 'demo',
      action: 'send',
      input: { message: 'hi' },
      caller: { kind: 'workflow', runId: 'run_1', nodeId: 'notify' },
      ctx: {
        organizationId: ORG,
        mode: 'live',
        credentials: resolver(),
        approvals,
        audit,
      },
    });
    expect(result.status).toBe('ok');
    expect(approvals.calls).toBe(0);
    expect(audit.records[0]).toMatchObject({
      callerKind: 'workflow',
      callerRef: 'run_1/notify',
      outcome: 'ok',
    });
  });

  it('records a failed invocation with its outcome', async () => {
    const audit = auditSink();
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'explode',
        input: {},
        caller: { kind: 'workflow', runId: 'run_1', nodeId: 'boom' },
        ctx: {
          organizationId: ORG,
          mode: 'live',
          credentials: resolver(),
          audit,
        },
      }),
    ).rejects.toThrow(IntegrationError);
    expect(audit.records[0]).toMatchObject({
      outcome: 'error',
      error: expect.stringContaining('vendor said no'),
    });
  });
});

describe('the credential seam', () => {
  it('refuses a live call with no resolver injected', async () => {
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'echo',
        input: { message: 'hi' },
        caller: { kind: 'user', userId: 'u1' },
        ctx: { organizationId: ORG, mode: 'live' },
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_RESOLVER_MISSING' });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('reports an unresolvable credential without reaching the vendor', async () => {
    const credentials: CredentialResolver = {
      resolve: async () => {
        throw new Error('no active credential for demo');
      },
    };
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'echo',
        input: { message: 'hi' },
        caller: { kind: 'user', userId: 'u1' },
        ctx: { organizationId: ORG, mode: 'live', credentials },
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_UNRESOLVED' });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('refuses a credential whose endpoint escapes the connector allowlist', async () => {
    await expect(
      executeIntegrationAction({
        connector: 'demo',
        action: 'echo',
        input: { message: 'hi' },
        caller: { kind: 'user', userId: 'u1' },
        ctx: {
          organizationId: ORG,
          mode: 'live',
          credentials: resolver({ endpoint: 'https://attacker.example' }),
        },
      }),
    ).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
