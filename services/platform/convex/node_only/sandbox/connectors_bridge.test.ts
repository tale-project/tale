// Coverage for the connectors-bridge decision bodies — the server side of
// `tale-connectors-mcp`. Runs against the REAL shipped connector catalog
// (tavily.search is read; github.create_issue is write), so the read-only rule
// is tested against the same files production reads. Both bodies take their
// host as a SEAM (a dispatch function, a credential probe), so the tests pass
// fakes for them; the dispatcher's own behavior is covered by the connectors
// suite, and the forensic audit row belongs to the door that calls these
// (`backend/domains/connectors/bridge-routes.ts`).

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';

type Dispatch = (
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;
type Probe = (args: {
  organizationId: string;
  connectorSlug: string;
}) => Promise<boolean>;
type DispatchFn = (
  dispatch: Dispatch,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;
type StatusFn = (
  probe: Probe,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

async function getActions(): Promise<{
  dispatch: DispatchFn;
  status: StatusFn;
}> {
  const mod = await import('./connectors_bridge');
  return {
    dispatch: mod.runBridgeConnectorImpl as unknown as DispatchFn,
    status: mod.bridgeConnectorStatusImpl as unknown as StatusFn,
  };
}

/** A dispatch seam that must not be reached — refusal paths decide before
 *  any connector runs. */
const neverDispatches: Dispatch = () => {
  throw new Error('the dispatch seam must not be reached on a refusal path');
};

const BASE = {
  organizationId: 'org_1',
  sessionId: 'session_1',
  userId: 'user_1',
};

describe('dispatchBridgeConnectorImpl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses an unshipped connector without dispatching', async () => {
    const { dispatch } = await getActions();

    const result = await dispatch(neverDispatches, {
      ...BASE,
      slug: 'not-a-connector',
      operation: 'search',
      callArgs: {},
    });

    expect(result.status).toBe('unavailable');
  });

  it('lists the read operations on an unknown operation', async () => {
    const { dispatch } = await getActions();

    const result = await dispatch(neverDispatches, {
      ...BASE,
      slug: 'tavily',
      operation: 'nonsense',
      callArgs: {},
    });

    expect(result.status).toBe('invalid_args');
    expect(result.message).toContain('search');
  });

  it('refuses a write action — V1 is read-only', async () => {
    const { dispatch } = await getActions();

    const result = await dispatch(neverDispatches, {
      ...BASE,
      slug: 'github',
      operation: 'create_issue',
      callArgs: { title: 'x' },
    });

    expect(result).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'write_not_supported' }],
    });
  });

  it('dispatches a read action live as the turn user and maps ok', async () => {
    const runDispatch = vi.fn().mockResolvedValue({
      status: 'ok',
      output: { results: [1] },
    });
    const { dispatch } = await getActions();

    const result = await dispatch(runDispatch as unknown as Dispatch, {
      ...BASE,
      slug: 'tavily',
      operation: 'search',
      callArgs: { query: 'hello' },
    });

    expect(runDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        connector: 'tavily',
        action: 'search',
        input: { query: 'hello' },
        userId: 'user_1',
        // The turn's own session doubles as the connector's out-of-process
        // runner.
        execSessionId: 'session_1',
      }),
    );
    expect(result).toEqual({ status: 'ok', output: { results: [1] } });
  });

  it('maps approval-required to requires_approval', async () => {
    const runDispatch = vi.fn().mockResolvedValue({
      status: 'approval-required',
      message: 'Waiting for approval.',
    });
    const { dispatch } = await getActions();

    const result = await dispatch(runDispatch as unknown as Dispatch, {
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
    const runDispatch = vi.fn().mockRejectedValue(
      new AppError({
        message: 'No credential is connected.',
        hint: 'Connect one under Settings → Connectors.',
      }),
    );
    const { dispatch } = await getActions();

    const result = await dispatch(runDispatch as unknown as Dispatch, {
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

describe('bridgeConnectorStatusImpl', () => {
  beforeEach(() => vi.clearAllMocks());

  const noProbe: Probe = () => {
    throw new Error('the credential probe must not be reached');
  };

  it('says plainly when nothing is equipped', async () => {
    const { status } = await getActions();

    const result = await status(noProbe, {
      organizationId: 'org_1',
      grants: [],
    });

    expect(result.connectors).toEqual([]);
    expect(String(result.note)).toContain('No connectors are equipped');
  });

  it('reports usable / blocked per granted slug', async () => {
    // tavily has an active default credential; github has none.
    const probe: Probe = ({ connectorSlug }) =>
      Promise.resolve(connectorSlug === 'tavily');
    const { status } = await getActions();

    const result = (await status(probe, {
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
