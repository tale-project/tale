// Coverage for the connectors-bridge decision bodies — the server side of
// `tale-connectors-mcp`. Runs against the REAL shipped connector catalog
// (tavily.search is read; github.create_issue is write), so the read-only rule
// is tested against the same files production reads. Both bodies take their
// host as a SEAM (a dispatch function, a credential probe), so the tests pass
// fakes for them; the dispatcher's own behavior is covered by the connectors
// suite, and the forensic audit row belongs to the door that calls these
// (`backend/domains/connectors/bridge-routes.ts`).

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ConnectorError } from '../../../../lib/connectors/errors';
import { AppError } from '../../../../lib/shared/errors/app-error';

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

  // The connector door throws ConnectorError, not AppError. Before the
  // bridge read it, every coded refusal came back as "The connector call
  // failed unexpectedly.", so an agent could neither fix its arguments nor
  // tell the user what to reconnect.
  it('hands malformed arguments back as invalid_args with the refusal and its hint', async () => {
    const runDispatch = vi
      .fn()
      .mockRejectedValue(
        new ConnectorError(
          'INPUT_INVALID',
          "input does not match the tavily.search schema: input must have required property 'query'",
          { hint: 'you passed: {}' },
        ),
      );
    const { dispatch } = await getActions();

    const result = await dispatch(runDispatch as unknown as Dispatch, {
      ...BASE,
      slug: 'tavily',
      operation: 'search',
      callArgs: {},
    });

    expect(result).toEqual({
      status: 'invalid_args',
      message:
        "input does not match the tavily.search schema: input must have required property 'query'. you passed: {}.",
    });
  });

  it('reports a credential the door cannot resolve as the no_credential blocker', async () => {
    const runDispatch = vi
      .fn()
      .mockRejectedValue(
        new ConnectorError(
          'CREDENTIAL_UNRESOLVED',
          'no usable credential for tavily: no active credential',
          {
            hint: 'connect the connector, or mark one of its credentials as the default',
          },
        ),
      );
    const { dispatch } = await getActions();

    const result = await dispatch(runDispatch as unknown as Dispatch, {
      ...BASE,
      slug: 'tavily',
      operation: 'search',
      callArgs: { query: 'x' },
    });

    expect(result).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'no_credential' }],
    });
    const guidance = (result.blockers as Array<{ guidance: string }>)[0]
      ?.guidance;
    expect(guidance).toContain('no usable credential for tavily');
    expect(guidance).toContain('Settings → Connectors');
  });

  it('surfaces a vendor or egress refusal with its sentence and hint', async () => {
    const runDispatch = vi.fn().mockRejectedValue(
      new ConnectorError('HOST_NOT_ALLOWED', 'api.example.com is not allowed', {
        hint: 'Check the credential endpoint.',
      }),
    );
    const { dispatch } = await getActions();

    const result = await dispatch(runDispatch as unknown as Dispatch, {
      ...BASE,
      slug: 'tavily',
      operation: 'search',
      callArgs: { query: 'x' },
    });

    expect(result).toEqual({
      status: 'error',
      message: 'api.example.com is not allowed. Check the credential endpoint.',
    });
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

  it('puts a turn-wide caller refusal on every shipped connector, first', async () => {
    const probe: Probe = ({ connectorSlug }) =>
      Promise.resolve(connectorSlug === 'tavily');
    const { status } = await getActions();
    const callerBlocker = {
      code: 'no_user_context',
      guidance: 'This task run was not started by a member.',
    };

    const result = (await status(probe, {
      organizationId: 'org_1',
      grants: ['tavily', 'github', 'not-shipped'],
      callerBlocker,
    })) as {
      connectors: Array<Record<string, unknown>>;
    };

    const bySlug = new Map(
      result.connectors.map((entry) => [entry.slug, entry]),
    );
    expect(bySlug.get('tavily')).toMatchObject({
      usable: false,
      blockers: [callerBlocker],
    });
    expect(bySlug.get('github')).toMatchObject({
      usable: false,
      blockers: [callerBlocker, { code: 'no_credential' }],
    });
    // A connector that does not ship is refused for that reason alone.
    expect(bySlug.get('not-shipped')).toMatchObject({
      blockers: [{ code: 'unknown_connector' }],
    });
  });
});

describe('readTurnConnectorCaller', () => {
  it('reads the task run a host binds a turn to', async () => {
    const { readTurnConnectorCaller } = await import('./connectors_bridge');

    expect(
      readTurnConnectorCaller({ kind: 'task-run', execId: 'exec_1' }),
    ).toEqual({ kind: 'task-run', execId: 'exec_1' });
  });

  it.each([
    ['absent', undefined],
    ['not an object', 'exec_1'],
    ['a task run without an exec', { kind: 'task-run', execId: '' }],
    // A person on the token is never a caller: the bridge reads the person
    // from the live run, so a scope cannot name one.
    ['a person named directly', { kind: 'user', userId: 'user_1' }],
    ['a caller mode no host writes', { kind: 'system', reason: 'x' }],
  ])('reads %s as no caller at all', async (_label, value) => {
    const { readTurnConnectorCaller } = await import('./connectors_bridge');

    expect(readTurnConnectorCaller(value)).toBeUndefined();
  });
});
