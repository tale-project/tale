// Coverage for the connectors-bridge dispatch actions — the server side of
// `tale-connectors-mcp`. Runs against the REAL shipped connector catalog
// (tavily.search is read; github.create_issue is write), so the read-only rule
// is tested against the same files production reads. The dispatcher itself is
// mocked at ctx.runAction — its own behavior is covered by the connectors
// suite; here we lock the bridge's mapping and gating.

import { ConvexError } from 'convex/values';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalAction: (config: Record<string, unknown>) => config,
  };
});

type Handler = (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

async function getActions(): Promise<{
  dispatch: Handler;
  status: Handler;
}> {
  const mod = await import('./connectors_bridge');
  return {
    dispatch: (mod.dispatchBridgeConnector as unknown as { handler: Handler })
      .handler,
    status: (mod.bridgeConnectorStatus as unknown as { handler: Handler })
      .handler,
  };
}

function createCtx(overrides: {
  runAction?: ReturnType<typeof vi.fn>;
  runQuery?: ReturnType<typeof vi.fn>;
  runMutation?: ReturnType<typeof vi.fn>;
}) {
  return {
    runAction: overrides.runAction ?? vi.fn(),
    runQuery: overrides.runQuery ?? vi.fn(),
    // The dispatch audits every call (recordConnectorCall); the mock must
    // return a thenable since the handler `.catch()`es it.
    runMutation: overrides.runMutation ?? vi.fn(() => Promise.resolve(null)),
  };
}

const BASE = {
  organizationId: 'org_1',
  sessionId: 'session_1',
  userId: 'user_1',
};

describe('dispatchBridgeConnector', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses an unshipped connector without dispatching', async () => {
    const ctx = createCtx({});
    const { dispatch } = await getActions();

    const result = await dispatch(ctx, {
      ...BASE,
      slug: 'not-a-connector',
      operation: 'search',
      callArgs: {},
    });

    expect(result.status).toBe('unavailable');
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('lists the read operations on an unknown operation', async () => {
    const ctx = createCtx({});
    const { dispatch } = await getActions();

    const result = await dispatch(ctx, {
      ...BASE,
      slug: 'tavily',
      operation: 'nonsense',
      callArgs: {},
    });

    expect(result.status).toBe('invalid_args');
    expect(result.message).toContain('search');
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('refuses a write action — V1 is read-only', async () => {
    const ctx = createCtx({});
    const { dispatch } = await getActions();

    const result = await dispatch(ctx, {
      ...BASE,
      slug: 'github',
      operation: 'create_issue',
      callArgs: { title: 'x' },
    });

    expect(result).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'write_not_supported' }],
    });
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('dispatches a read action live as the turn user and maps ok', async () => {
    const runAction = vi.fn().mockResolvedValue({
      status: 'ok',
      output: { results: [1] },
    });
    const ctx = createCtx({ runAction });
    const { dispatch } = await getActions();

    const result = await dispatch(ctx, {
      ...BASE,
      slug: 'tavily',
      operation: 'search',
      callArgs: { query: 'hello' },
    });

    expect(runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org_1',
        connector: 'tavily',
        action: 'search',
        input: { query: 'hello' },
        mode: 'live',
        caller: { kind: 'user', userId: 'user_1' },
      }),
    );
    expect(result).toEqual({ status: 'ok', output: { results: [1] } });
  });

  it('writes a forensic audit row (slug/operation/outcome, no values)', async () => {
    const runAction = vi.fn().mockResolvedValue({ status: 'ok', output: {} });
    const runMutation = vi.fn(() => Promise.resolve(null));
    const ctx = createCtx({ runAction, runMutation });
    const { dispatch } = await getActions();

    await dispatch(ctx, {
      ...BASE,
      slug: 'tavily',
      operation: 'search',
      callArgs: { query: 'secret query text' },
    });

    expect(runMutation).toHaveBeenCalledTimes(1);
    const audit = (runMutation.mock.calls[0] as unknown[])[1] as Record<
      string,
      unknown
    >;
    expect(audit.slug).toBe('tavily');
    expect(audit.operation).toBe('search');
    expect(audit.outcome).toBe('ok');
    expect(audit.sessionId).toBe('session_1');
    // The fingerprint is param KEYS only — never the values.
    expect(audit.paramsFingerprint).toBe('query');
    expect(JSON.stringify(audit)).not.toContain('secret query text');
  });

  it('maps approval-required to requires_approval', async () => {
    const runAction = vi.fn().mockResolvedValue({
      status: 'approval-required',
      message: 'Waiting for approval.',
    });
    const ctx = createCtx({ runAction });
    const { dispatch } = await getActions();

    const result = await dispatch(ctx, {
      ...BASE,
      slug: 'tavily',
      operation: 'search',
      callArgs: {},
    });

    expect(result).toEqual({
      status: 'requires_approval',
      message: 'Waiting for approval.',
    });
  });

  it("surfaces the dispatcher's coded refusal with its hint", async () => {
    const runAction = vi.fn().mockRejectedValue(
      new ConvexError({
        message: 'No credential is connected.',
        hint: 'Connect one under Settings → Connectors.',
      }),
    );
    const ctx = createCtx({ runAction });
    const { dispatch } = await getActions();

    const result = await dispatch(ctx, {
      ...BASE,
      slug: 'tavily',
      operation: 'search',
      callArgs: {},
    });

    expect(result.status).toBe('error');
    expect(result.message).toContain('No credential is connected.');
    expect(result.message).toContain('Settings → Connectors');
  });
});

describe('bridgeConnectorStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says plainly when nothing is equipped', async () => {
    const ctx = createCtx({});
    const { status } = await getActions();

    const result = await status(ctx, { organizationId: 'org_1', grants: [] });

    expect(result.connectors).toEqual([]);
    expect(String(result.note)).toContain('No connectors are equipped');
  });

  it('reports usable / blocked per granted slug', async () => {
    // tavily resolves an active default credential; github resolves none.
    const runQuery = vi.fn().mockImplementation((_ref, args) => {
      const { connectorSlug } = args as { connectorSlug: string };
      return Promise.resolve(
        connectorSlug === 'tavily' ? { status: 'active' } : null,
      );
    });
    const ctx = createCtx({ runQuery });
    const { status } = await getActions();

    const result = (await status(ctx, {
      organizationId: 'org_1',
      grants: ['tavily', 'github', 'not-shipped'],
    })) as {
      connectors: Array<Record<string, unknown>>;
    };

    const bySlug = new Map(
      result.connectors.map((entry) => [entry.slug, entry]),
    );
    expect(bySlug.get('tavily')).toMatchObject({
      usable: true,
      blockers: [],
    });
    expect(bySlug.get('tavily')?.operations).toContain('search');
    expect(bySlug.get('github')).toMatchObject({
      usable: false,
      blockers: [{ code: 'no_credential' }],
    });
    expect(bySlug.get('not-shipped')).toMatchObject({
      usable: false,
      blockers: [{ code: 'unknown_connector' }],
    });
  });
});
