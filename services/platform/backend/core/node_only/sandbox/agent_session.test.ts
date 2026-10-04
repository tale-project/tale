// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../../lib/shared/handlers/function-refs';
import { ensureAgentSession, type AgentSessionOwner } from './agent_session';
import {
  SessionDuplicateError,
  SessionNotFoundError,
  SpawnerBusyError,
} from './helpers/session_client';

const runtime = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  sessionAcquire: vi.fn(),
  sessionDestroyIfIdle: vi.fn(),
}));
vi.mock('./helpers/session_client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./helpers/session_client')>()),
  ...runtime,
}));

interface Scenario {
  owner: AgentSessionOwner;
  ownerId: string;
  /** What else the owner lookup names: a project agent owns more than one
   * workspace, so its row is found by session id too. */
  lookup: Record<string, string>;
  createdBy: string;
  release: string;
  releaseArgs: Record<string, string>;
}

const scenarios: Scenario[] = [
  {
    owner: { type: 'project_agent', agentId: 'agent_1' },
    ownerId: 'agent_1',
    lookup: { sessionId: 'session_1' },
    createdBy: 'system:task-agent',
    release: 'releaseProjectAgentSessionSlot',
    releaseArgs: { organizationId: 'org_1', agentId: 'agent_1' },
  },
  {
    owner: { type: 'workflow_run', runId: 'run_1' },
    ownerId: 'run_1:@workflow',
    lookup: {},
    createdBy: 'system:automation',
    release: 'hibernateAutomationScopedSession',
    releaseArgs: { executionId: 'run_1' },
  },
];

function fixture(
  scenario: Scenario,
  existing: { status: string; createdAt: number } | null,
  failMutation?: string,
) {
  const events: string[] = [];
  const mutationError = new Error('admission or release failed');
  const ctx = {
    runQuery: vi.fn(async () => existing),
    runMutation: vi.fn(
      async (ref: unknown, _args: unknown): Promise<string | boolean> => {
        const name = functionRefName(ref).split(':')[1];
        events.push(name ?? 'unknown');
        if (name === failMutation) throw mutationError;
        return 'row_1';
      },
    ),
  };
  runtime.sessionCreate.mockImplementation(async () => {
    events.push('create');
  });
  runtime.sessionDestroyIfIdle.mockImplementation(async () => {
    events.push('destroy');
    return { destroyed: true, busy: false };
  });
  return {
    ctx,
    events,
    mutationError,
    ensure: () =>
      ensureAgentSession(ctx, {
        organizationId: 'org_1',
        sessionId: 'session_1',
        owner: scenario.owner,
      }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  runtime.sessionAcquire.mockResolvedValue(true);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe.each(scenarios)('ensureAgentSession ($owner.type)', (scenario) => {
  it('reuses a live session with its existing incarnation and no new slot', async () => {
    const f = fixture(scenario, { status: 'active', createdAt: 123 });

    await expect(f.ensure()).resolves.toEqual({ liveCreatedAt: 123 });

    expect(f.ctx.runQuery).toHaveBeenCalledWith(expect.anything(), {
      ownerType: scenario.owner.type,
      ownerId: scenario.ownerId,
      ...scenario.lookup,
    });
    expect(runtime.sessionAcquire).toHaveBeenCalledWith('session_1');
    expect(f.events).toEqual(['resumeSessionSlotWithCapCheck']);
    expect(runtime.sessionCreate).not.toHaveBeenCalled();
  });

  it('re-admits a released slot even when its compute is still warm', async () => {
    const f = fixture(scenario, { status: 'stopped', createdAt: 123 });

    await expect(f.ensure()).resolves.toEqual({ liveCreatedAt: 123 });

    expect(f.events).toEqual(['resumeSessionSlotWithCapCheck']);
    expect(f.ctx.runMutation).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      sessionId: 'session_1',
    });
    expect(runtime.sessionCreate).not.toHaveBeenCalled();
  });

  it('does not acquire compute if its allocation disappeared after the owner lookup', async () => {
    const f = fixture(scenario, { status: 'active', createdAt: 123 });
    f.ctx.runMutation.mockResolvedValueOnce(false);

    await expect(f.ensure()).rejects.toThrow('allocation');

    expect(runtime.sessionAcquire).not.toHaveBeenCalled();
    expect(runtime.sessionCreate).not.toHaveBeenCalled();
  });

  it('reserves quota before recreating compute and preserves the workspace incarnation', async () => {
    const f = fixture(scenario, { status: 'stopped', createdAt: 123 });
    runtime.sessionAcquire.mockResolvedValue(false);

    await expect(f.ensure()).resolves.toEqual({ liveCreatedAt: 123 });

    expect(f.events).toEqual(['resumeSessionSlotWithCapCheck', 'create']);
    // Agent and workflow workspaces may start on a connected device.
    expect(runtime.sessionCreate).toHaveBeenCalledWith({
      organizationId: 'org_1',
      sessionId: 'session_1',
      profile: 'agent',
      placement: 'device',
      workload: scenario.owner.type === 'workflow_run' ? 'workflow' : 'project',
    });
  });

  it.each([true, false])(
    'a full organization refuses before provisioning (warm=%s)',
    async (warm) => {
      const f = fixture(
        scenario,
        { status: 'stopped', createdAt: 123 },
        'resumeSessionSlotWithCapCheck',
      );
      runtime.sessionAcquire.mockResolvedValue(warm);

      await expect(f.ensure()).rejects.toBe(f.mutationError);

      expect(f.events).toEqual(['resumeSessionSlotWithCapCheck']);
      expect(runtime.sessionCreate).not.toHaveBeenCalled();
      expect(runtime.sessionAcquire).not.toHaveBeenCalled();
    },
  );

  // The rollback asks for the owner's release; while this turn's run row is
  // still live the release's own guard defers it to the settle, which runs
  // after the run is marked failed.
  it('asks for the slot release without recreating compute when acquisition is unknown', async () => {
    const f = fixture(scenario, { status: 'active', createdAt: 123 });
    const error = new Error('spawner unreachable');
    runtime.sessionAcquire.mockRejectedValue(error);

    await expect(f.ensure()).rejects.toBe(error);

    expect(f.events).toEqual([
      'resumeSessionSlotWithCapCheck',
      scenario.release,
    ]);
    expect(runtime.sessionCreate).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'failed resume releases only the owner slot and preserves the original error (release fails=%s)',
    async (releaseFails) => {
      const f = fixture(
        scenario,
        { status: 'stopped', createdAt: 123 },
        releaseFails ? scenario.release : undefined,
      );
      runtime.sessionAcquire.mockResolvedValue(false);
      const error = new Error('container create failed');
      runtime.sessionCreate.mockRejectedValue(error);

      await expect(f.ensure()).rejects.toBe(error);

      expect(f.events).toEqual([
        'resumeSessionSlotWithCapCheck',
        scenario.release,
      ]);
      expect(f.ctx.runMutation).toHaveBeenLastCalledWith(
        expect.anything(),
        scenario.releaseArgs,
      );
      // The standing workspace is the incarnation's state: a failed resume
      // releases the slot and never destroys it.
      expect(runtime.sessionDestroyIfIdle).not.toHaveBeenCalled();
    },
  );

  it('adopts a concurrent runtime without releasing its existing incarnation', async () => {
    const f = fixture(scenario, { status: 'stopped', createdAt: 123 });
    runtime.sessionAcquire.mockResolvedValueOnce(false).mockResolvedValue(true);
    runtime.sessionCreate.mockRejectedValue(
      new SessionDuplicateError('session_1'),
    );

    await expect(f.ensure()).resolves.toEqual({ liveCreatedAt: 123 });

    expect(f.events).toEqual(['resumeSessionSlotWithCapCheck']);
  });

  it.each([false, true])(
    'a fresh row reserves before create and cannot resume an old conversation (adopt=%s)',
    async (adopt) => {
      const f = fixture(scenario, null);
      if (adopt) {
        runtime.sessionCreate.mockImplementation(async () => {
          f.events.push('create');
          throw new SessionDuplicateError('session_1');
        });
      }

      await expect(f.ensure()).resolves.toEqual({ liveCreatedAt: undefined });

      expect(f.events).toEqual([
        'reserveSessionSlotAndInsert',
        'create',
        'setSessionStatus',
      ]);
      expect(f.ctx.runMutation).toHaveBeenNthCalledWith(1, expect.anything(), {
        organizationId: 'org_1',
        sessionId: 'session_1',
        profile: 'agent',
        ownerType: scenario.owner.type,
        ownerId: scenario.ownerId,
        createdBy: scenario.createdBy,
      });
      expect(f.ctx.runMutation).toHaveBeenLastCalledWith(expect.anything(), {
        rowId: 'row_1',
        status: 'active',
      });
      expect(runtime.sessionAcquire).toHaveBeenCalledTimes(adopt ? 1 : 0);
      expect(runtime.sessionDestroyIfIdle).not.toHaveBeenCalled();
    },
  );

  it('does not provision a fresh session when its slot reservation fails', async () => {
    const f = fixture(scenario, null, 'reserveSessionSlotAndInsert');

    await expect(f.ensure()).rejects.toBe(f.mutationError);

    expect(runtime.sessionCreate).not.toHaveBeenCalled();
    expect(runtime.sessionDestroyIfIdle).not.toHaveBeenCalled();
  });

  it('marks a failed fresh create as failed instead of leaving its quota occupied', async () => {
    const f = fixture(scenario, null);
    const error = new Error('container create failed');
    runtime.sessionCreate.mockRejectedValue(error);

    await expect(f.ensure()).rejects.toBe(error);

    expect(f.ctx.runMutation).toHaveBeenLastCalledWith(expect.anything(), {
      rowId: 'row_1',
      status: 'failed',
    });
    expect(f.events).toEqual([
      'reserveSessionSlotAndInsert',
      'destroy',
      'setSessionStatus',
    ]);
  });

  // A refused create (429: the host is full, or short of memory) made
  // nothing — and a destroy of an id with no compute deletes the preserved
  // workspace a stopped standing session keeps under it.
  it('a create the sandbox host refused destroys nothing, and the row reads failed', async () => {
    const f = fixture(scenario, null);
    const error = new SpawnerBusyError(15_000);
    runtime.sessionCreate.mockImplementation(async () => {
      f.events.push('create');
      throw error;
    });

    await expect(f.ensure()).rejects.toBe(error);

    expect(runtime.sessionDestroyIfIdle).not.toHaveBeenCalled();
    expect(f.events).toEqual([
      'reserveSessionSlotAndInsert',
      'create',
      'setSessionStatus',
    ]);
    // Settled as collected: the COLLECT pass would otherwise run the very
    // destroy this skipped once the row's grace had passed.
    expect(f.ctx.runMutation).toHaveBeenLastCalledWith(expect.anything(), {
      rowId: 'row_1',
      status: 'failed',
      collected: true,
    });
  });

  // The regression (#3494): a create the spawner had started, then failed —
  // its container stayed in Docker state `created` with no owner to remove it.
  it('destroys what a created-then-failed session left spawner-side before its row reads failed', async () => {
    const f = fixture(scenario, null);
    const error = new Error('runnerd did not become ready');
    runtime.sessionCreate.mockImplementation(async () => {
      f.events.push('create');
      throw error;
    });

    await expect(f.ensure()).rejects.toBe(error);

    expect(runtime.sessionDestroyIfIdle).toHaveBeenCalledTimes(1);
    expect(runtime.sessionDestroyIfIdle).toHaveBeenCalledWith('session_1');
    // While the row is still `creating` it holds the owner's slot, so no
    // fresh create of the same id can start under the destroy.
    expect(f.events).toEqual([
      'reserveSessionSlotAndInsert',
      'create',
      'destroy',
      'setSessionStatus',
    ]);
    expect(f.ctx.runMutation).toHaveBeenLastCalledWith(expect.anything(), {
      rowId: 'row_1',
      status: 'failed',
    });
  });

  it('destroys an adopted orphan that turned out to be gone', async () => {
    const f = fixture(scenario, null);
    runtime.sessionCreate.mockImplementation(async () => {
      f.events.push('create');
      throw new SessionDuplicateError('session_1');
    });
    runtime.sessionAcquire.mockResolvedValue(false);

    await expect(f.ensure()).rejects.toBeInstanceOf(SessionNotFoundError);

    expect(runtime.sessionDestroyIfIdle).toHaveBeenCalledWith('session_1');
    expect(f.events).toEqual([
      'reserveSessionSlotAndInsert',
      'create',
      'destroy',
      'setSessionStatus',
    ]);
  });

  it('a destroy that fails is logged, never thrown: the row still reads failed and the create error survives', async () => {
    const f = fixture(scenario, null);
    const error = new Error('container create failed');
    runtime.sessionCreate.mockRejectedValue(error);
    const destroyError = new Error('sandbox session destroy failed (502)');
    runtime.sessionDestroyIfIdle.mockRejectedValue(destroyError);

    await expect(f.ensure()).rejects.toBe(error);

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('destroy after failed create of session_1'),
      destroyError,
    );
    expect(f.ctx.runMutation).toHaveBeenLastCalledWith(expect.anything(), {
      rowId: 'row_1',
      status: 'failed',
    });
  });

  // A sibling turn of the same owner can resume the still-`creating` row and
  // create or adopt the session itself: this turn's failure must never kill
  // the exec that turn is running.
  it('leaves a session a sibling turn is executing in, and still reads failed', async () => {
    const f = fixture(scenario, null);
    const error = new Error('runnerd did not become ready');
    runtime.sessionCreate.mockRejectedValue(error);
    runtime.sessionDestroyIfIdle.mockResolvedValue({
      destroyed: false,
      busy: true,
    });

    await expect(f.ensure()).rejects.toBe(error);

    expect(runtime.sessionDestroyIfIdle).toHaveBeenCalledWith('session_1');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("runs a sibling turn's exec"),
    );
    expect(f.ctx.runMutation).toHaveBeenLastCalledWith(expect.anything(), {
      rowId: 'row_1',
      status: 'failed',
    });
  });
});

describe('ensureAgentSession — the harness names the session', () => {
  it('reserves a fresh session under the harness it will run, so the metrics can name it', async () => {
    const f = fixture(scenarios[0]!, null);
    await ensureAgentSession(f.ctx, {
      organizationId: 'org_1',
      sessionId: 'session_1',
      owner: scenarios[0]!.owner,
      agentKind: 'claude-code',
    });
    const reserve = f.ctx.runMutation.mock.calls.find(
      ([ref]) =>
        functionRefName(ref).split(':')[1] === 'reserveSessionSlotAndInsert',
    );
    expect(reserve?.[1]).toMatchObject({
      sessionId: 'session_1',
      agentKind: 'claude-code',
    });
  });

  it('leaves the kind unset for a session no harness opens', async () => {
    const f = fixture(scenarios[1]!, null);
    await f.ensure();
    const reserve = f.ctx.runMutation.mock.calls.find(
      ([ref]) =>
        functionRefName(ref).split(':')[1] === 'reserveSessionSlotAndInsert',
    );
    expect(reserve?.[1]).not.toHaveProperty('agentKind');
  });
});
