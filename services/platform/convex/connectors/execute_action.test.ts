// @vitest-environment node

import vm from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setCodeRunner, type CodeRunner } from '../../lib/engine/core/runner';
import { nodeVmRunner } from '../../lib/engine/runners/node-vm';
import type { Id } from '../_generated/dataModel';

/**
 * The Convex surface is wiring, so this suite proves the wiring: the shipped
 * catalog is assembled, the credential seam is consulted only when a call goes
 * live, every completed invocation lands in the org's audit chain, and a coded
 * refusal crosses the boundary as a coded `AppError`.
 *
 * The codegen surface is mocked the way the org-provisioning action suite does
 * it — `internalAction(config)` hands back the config, so the handler is
 * directly invokable with a hand-built ctx — and `fetch` is stubbed, so no test
 * here reaches a vendor.
 */

vi.mock('../_generated/server', () => ({
  internalAction: vi.fn((config: unknown) => config),
  // connector_catalog (imported for the shipped-catalog loader) declares its
  // public `listConnectors` action at module top level.
  action: vi.fn((config: unknown) => config),
}));

vi.mock('../_generated/api', () => ({
  internal: {
    audit_logs: {
      internal_mutations: { createAuditLog: 'createAuditLog' },
    },
    approvals: {
      gate: { evaluateApprovalGate: 'evaluateApprovalGate' },
    },
  },
}));

vi.mock('../connector_credentials/resolve_credential', () => ({
  resolveConnectorCredential: vi.fn(),
}));

const { resolveConnectorCredential } =
  await import('../connector_credentials/resolve_credential');
const resolveMock = vi.mocked(resolveConnectorCredential);

const { runConnectorAction } = await import('./execute_action');

interface TestCtx {
  runMutation: ReturnType<typeof vi.fn>;
}

/** What the mocked approvals gate returns; a test overrides it before acting. */
let gateDecision: unknown;

interface ActionShape {
  handler: (ctx: TestCtx, args: Record<string, unknown>) => Promise<unknown>;
}

const handler = (runConnectorAction as unknown as ActionShape).handler;

/** A runner able to hand a live body the host's capability functions — the
 * bundled node-vm backend is data-only and cannot. */
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
    // Identify as what it is: the dispatcher refuses live yaml-js on the
    // data-only 'node-vm' backend, and this double is exactly the
    // host-capable runner that rule waits for.
    kind: () => 'live-capable-test',
  };
}

let ctx: TestCtx;
let fetchStub: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setCodeRunner(liveCapableRunner());
  gateDecision = { decision: 'needs-approval', approvalId: 'appr_wired' };
  ctx = {
    runMutation: vi.fn(async (ref: unknown) =>
      ref === 'evaluateApprovalGate' ? gateDecision : null,
    ),
  };
  fetchStub = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          number: 42,
          html_url: 'https://github.com/tale/tale/issues/42',
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetchStub);
  vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '');
  resolveMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('runConnectorAction', () => {
  it('runs a shipped connector mock without credentials or IO', async () => {
    const result = await handler(ctx, {
      organizationId: 'org_1',
      connector: 'github',
      action: 'create_issue',
      input: { owner: 'tale', repo: 'tale', title: 'Something is broken' },
      caller: { kind: 'user', userId: 'user_1' },
    });
    expect(result).toMatchObject({
      status: 'ok',
      backend: 'mock',
      mode: 'mock',
      nodeType: 'github.create_issue',
    });
    expect(resolveMock).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('writes an audit row for every invocation', async () => {
    await handler(ctx, {
      organizationId: 'org_1',
      connector: 'tavily',
      action: 'search',
      input: { query: 'retrieval augmented generation' },
      caller: { kind: 'user', userId: 'user_1' },
    });
    expect(ctx.runMutation).toHaveBeenCalledWith('createAuditLog', {
      organizationId: 'org_1',
      actorId: 'user_1',
      actorType: 'user',
      action: 'connector.tavily.search',
      category: 'connector',
      resourceType: 'connector',
      resourceId: 'tavily.search',
      resourceName: 'tavily',
      status: 'success',
      metadata: expect.objectContaining({ mode: 'mock', effects: 'read' }),
    });
  });

  it('runs live through the credential seam and the mediated host', async () => {
    resolveMock.mockResolvedValue({
      credentialId: 'cred_1' as Id<'connectorCredentials'>,
      connectorSlug: 'github',
      authMethod: 'bearer',
      secrets: { token: 'ghp_secret' },
      authHeader: 'Bearer ghp_secret',
      config: {},
    });
    const result = await handler(ctx, {
      organizationId: 'org_1',
      connector: 'github',
      action: 'create_issue',
      input: { owner: 'tale', repo: 'tale', title: 'Ticket 7 needs a reply' },
      mode: 'live',
      caller: { kind: 'system', reason: 'conversation email reply' },
    });
    expect(result).toMatchObject({
      status: 'ok',
      backend: 'yaml-js',
      mode: 'live',
      output: { number: 42, url: 'https://github.com/tale/tale/issues/42' },
      credentialId: 'cred_1',
    });
    // The credential was resolved for this org and connector...
    expect(resolveMock.mock.calls[0][1]).toMatchObject({
      organizationId: 'org_1',
      connectorSlug: 'github',
    });
    // ...and the host, not the body, applied it.
    const [url, init] = fetchStub.mock.calls[0];
    expect(String(url)).toBe('https://api.github.com/repos/tale/tale/issues');
    expect(init.headers.Authorization).toBe('Bearer ghp_secret');
    // The deliberate approval bypass is recorded with its reason...
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'createAuditLog',
      expect.objectContaining({
        actorId: 'system',
        actorType: 'system',
        status: 'success',
        metadata: expect.objectContaining({
          mode: 'live',
          effects: 'write',
          reason: 'conversation email reply',
          credentialId: 'cred_1',
        }),
      }),
    );
    // ...and the gate is never consulted for a system caller — its bypass is by
    // audit, not by approval.
    expect(ctx.runMutation).not.toHaveBeenCalledWith(
      'evaluateApprovalGate',
      expect.anything(),
    );
  });

  it('gates a user-initiated live write through the approvals domain', async () => {
    const result = await handler(ctx, {
      organizationId: 'org_1',
      connector: 'github',
      action: 'create_issue',
      input: { owner: 'tale', repo: 'tale', title: 'Please approve me' },
      mode: 'live',
      caller: { kind: 'user', userId: 'user_1' },
    });
    // The write did not happen — it is waiting on a human, and the caller gets
    // the approval id to drive to resolution.
    expect(result).toMatchObject({
      status: 'approval-required',
      approvalId: 'appr_wired',
      nodeType: 'github.create_issue',
    });
    expect(fetchStub).not.toHaveBeenCalled();
    expect(resolveMock).not.toHaveBeenCalled();
    // The gate was consulted for this exact operation, as a write.
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'evaluateApprovalGate',
      expect.objectContaining({
        organizationId: 'org_1',
        source: 'connector',
        connector: 'github',
        action: 'create_issue',
        effect: 'write',
        requestedBy: 'user_1',
        resourceKey: expect.any(String),
      }),
    );
  });

  it('runs a user-initiated live write once approvals allow it', async () => {
    gateDecision = { decision: 'allow', approvalId: 'appr_wired' };
    resolveMock.mockResolvedValue({
      credentialId: 'cred_1' as Id<'connectorCredentials'>,
      connectorSlug: 'github',
      authMethod: 'bearer',
      secrets: { token: 'ghp_secret' },
      authHeader: 'Bearer ghp_secret',
      config: {},
    });
    const result = await handler(ctx, {
      organizationId: 'org_1',
      connector: 'github',
      action: 'create_issue',
      input: { owner: 'tale', repo: 'tale', title: 'Approved work' },
      mode: 'live',
      caller: { kind: 'user', userId: 'user_1' },
    });
    expect(result).toMatchObject({ status: 'ok', mode: 'live' });
    expect(fetchStub).toHaveBeenCalled();
  });

  it('does not consult the gate for a mock invocation or a read', async () => {
    await handler(ctx, {
      organizationId: 'org_1',
      connector: 'tavily',
      action: 'search',
      input: { query: 'retrieval augmented generation' },
      caller: { kind: 'user', userId: 'user_1' },
    });
    expect(ctx.runMutation).not.toHaveBeenCalledWith(
      'evaluateApprovalGate',
      expect.anything(),
    );
  });

  it('surfaces a coded refusal as a AppError payload', async () => {
    await expect(
      handler(ctx, {
        organizationId: 'org_1',
        connector: 'nope',
        action: 'do_something',
        input: {},
        caller: { kind: 'user', userId: 'user_1' },
      }),
    ).rejects.toMatchObject({
      data: { code: 'UNKNOWN_CONNECTOR', connector: 'nope' },
    });
  });

  it('refuses an input that does not match the action schema', async () => {
    await expect(
      handler(ctx, {
        organizationId: 'org_1',
        connector: 'github',
        action: 'create_issue',
        input: { owner: 'tale' },
        caller: { kind: 'user', userId: 'user_1' },
      }),
    ).rejects.toMatchObject({ data: { code: 'INPUT_INVALID' } });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
