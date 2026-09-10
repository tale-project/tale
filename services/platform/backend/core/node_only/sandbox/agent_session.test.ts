// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../../lib/shared/handlers/function-refs';
import { ensureAgentSession, type AgentSessionOwner } from './agent_session';
import { SessionDuplicateError } from './helpers/session_client';

const runtime = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  sessionAcquire: vi.fn(),
}));
vi.mock('./helpers/session_client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./helpers/session_client')>()),
  ...runtime,
}));

interface Scenario {
  owner: AgentSessionOwner;
  ownerId: string;
  createdBy: string;
  release: string;
  releaseArgs: Record<string, string>;
}

const scenarios: Scenario[] = [
  {
    owner: { type: 'project_agent', agentId: 'agent_1' },
    ownerId: 'agent_1',
    createdBy: 'system:task-agent',
    release: 'releaseProjectAgentSessionSlot',
    releaseArgs: { organizationId: 'org_1', agentId: 'agent_1' },
  },
  {
    owner: { type: 'workflow_run', runId: 'run_1' },
    ownerId: 'run_1:@workflow',
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
    expect(runtime.sessionCreate).toHaveBeenCalledWith({
      organizationId: 'org_1',
      sessionId: 'session_1',
      profile: 'agent',
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
    },
  );

  it('does not provision a fresh session when its slot reservation fails', async () => {
    const f = fixture(scenario, null, 'reserveSessionSlotAndInsert');

    await expect(f.ensure()).rejects.toBe(f.mutationError);

    expect(runtime.sessionCreate).not.toHaveBeenCalled();
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
      'setSessionStatus',
    ]);
  });
});
