/**
 * Process hygiene around a failed drain, a retry and a steer: the REAL
 * drive, start and steer hosts with only external I/O replaced.
 *
 *  - a drive window whose drain dies (an exhausted re-attach budget, a 502
 *    storm) settles the run failed — and must cancel the exec first, since
 *    the CLI is typically still alive and would keep working unobserved;
 *  - a start with a predecessor exec — here a Claude→Codex switch, so no
 *    resume — reaps it and waits until runnerd reports it gone BEFORE the
 *    new CLI launches on the same workspace and delivery box;
 *  - a steer's restart cancels the old exec as a rotation, keeping what the
 *    turn started outside its own processes for the restarted turn, while
 *    every other cancel (a Stop, a crash) ends everything;
 *  - the settle's harvest takes the first listing of a turn whose exec
 *    exited on its own, and re-reads an empty box after a reaped linger,
 *    whose processes may still be writing;
 *  - a Gemini turn's staged subscription credential leaves the session when
 *    the turn settles or is orphaned, unless a steer moved the run onto a
 *    newer exec that staged its own.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';

const io = vi.hoisted(() => ({
  cancels: [] as string[],
  /** The mode of each cancel, in order. */
  cancelModes: [] as Array<{ keepLeftovers?: boolean }>,
  statusPolls: [] as string[],
  starts: [] as Array<{ execId: string; argv: string[]; stdin?: string }>,
  released: [] as Array<{ execId: string; status: string }>,
  /** How many status probes still answer `running` for the predecessor. */
  predecessorRunningPolls: 0,
  drainThrows: false as boolean | 'disk-full',
  afterDrain: undefined as (() => void) | undefined,
  /** A terminal window the drain answers instead of `running`. */
  terminal: undefined as Record<string, unknown> | undefined,
  /** Every directory the harvest listed, in order. */
  listings: [] as string[],
  /** Every path set the session was asked to delete, in order. */
  deletes: [] as string[][],
}));

vi.mock('../chat/external_turn_shared', async (importActual) => {
  const actual =
    await importActual<typeof import('../chat/external_turn_shared')>();
  return {
    ...actual,
    drainHarnessWindow: async (args: {
      execId: string;
      start?: { argv: string[]; stdin?: string };
    }) => {
      if (io.drainThrows === 'disk-full') {
        const { ExecDiskFullError } =
          await import('../node_only/sandbox/helpers/session_client');
        throw new ExecDiskFullError();
      }
      if (io.drainThrows) {
        throw new Error('sandbox session attach failed (502)');
      }
      if (io.afterDrain !== undefined) {
        io.afterDrain();
        return {
          kind: 'terminal',
          text: 'Late completion',
          timeline: [],
          ended: { finalText: 'Late completion', isError: false },
        };
      }
      if (io.terminal !== undefined) return io.terminal;
      if (args.start !== undefined) {
        io.starts.push({
          execId: args.execId,
          argv: args.start.argv,
          ...(args.start.stdin !== undefined
            ? { stdin: args.start.stdin }
            : {}),
        });
      }
      return { kind: 'running', text: '', timeline: [] };
    },
  };
});
vi.mock('../automations/agent_host', () => ({
  liveProgressSink: () => ({
    onText() {},
    onTimeline() {},
    async flush() {},
  }),
  releaseTurnKey: async (
    _ctx: unknown,
    args: { execId: string; status: string },
  ) => {
    io.released.push({ execId: args.execId, status: args.status });
    return { won: true };
  },
  stageWorkflowSkills: async () => '',
}));
vi.mock('../node_only/sandbox/helpers/session_client', async (importActual) => {
  const actual =
    await importActual<
      typeof import('../node_only/sandbox/helpers/session_client')
    >();
  return {
    ...actual,
    sessionCancelExec: async (
      _sessionId: string,
      execId: string,
      mode: { keepLeftovers?: boolean } = {},
    ) => {
      io.cancels.push(execId);
      io.cancelModes.push(mode);
      return true;
    },
    sessionExecStatus: async (_sessionId: string, execId: string) => {
      io.statusPolls.push(execId);
      if (io.predecessorRunningPolls > 0) {
        io.predecessorRunningPolls -= 1;
        return { state: 'running' };
      }
      return { state: 'exited', exitCode: 137 };
    },
    sessionDeleteFiles: async (_sessionId: string, paths: string[]) => {
      io.deletes.push(paths);
      return { deleted: paths, skipped: [] };
    },
    sessionListFiles: async (_sessionId: string, dir: string) => {
      io.listings.push(dir);
      return [];
    },
    sessionStageFiles: async () => ({ staged: [], skipped: [] }),
  };
});
// The settle's harvest stores into the organization's own bucket.
vi.mock('../lib/helpers/org_slug', () => ({
  orgSlugFromIdOrNull: async () => 'acme',
}));
vi.mock('../node_only/sandbox/agent_session', () => ({
  ensureAgentSession: async () => ({ liveCreatedAt: 1000 }),
}));
vi.mock('./task_serving', () => ({
  resolveTaskServing: async () => ({
    lane: 'gateway',
    providerSlug: 'openai',
    modelId: 'gpt-5',
  }),
}));
vi.mock('../lib/providers/resolve_vision_model', () => ({
  resolveTurnVisionModel: async () => null,
}));
vi.mock('../node_only/sandbox/gateway_provisioning', () => ({
  provisionSessionGatewayKey: async () => ({
    token: 'test-token',
    keyId: 'key-new',
    keyHash: 'hash-new',
  }),
}));
vi.mock('../node_only/sandbox/turn_equipment', () => ({
  resolveTurnEquipmentEnv: async () => ({}),
}));

const {
  driveTaskAgentTurnImpl,
  startTaskAgentTurnImpl,
  steerTaskAgentTurnImpl,
} = await import('./agent_run_host');

interface RunState {
  status: string;
  execId: string;
}

function makeCtx(run: RunState) {
  const mutations: Array<{ name: string; args: Record<string, unknown> }> = [];
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = functionRefName(ref);
      if (name === 'tasks/agent_runs:getTaskAgentRunForDrive') return run;
      if (name === 'projects/internal_queries:getProjectAgentSkillScope') {
        return null;
      }
      if (name === 'tasks/agent_runs:getAgentLanguageContext') {
        return {
          defaultLocale: 'fr',
          task: { id: 'task-1', title: 'Unterlagen prüfen', description: null },
        };
      }
      if (name === 'tasks/agent_runs:getTaskBriefForAgentRun') {
        return {
          title: 'Continue draft',
          attachments: [],
          outputs: [],
          discussion: [],
        };
      }
      // No Custom instructions policy in this organization.
      if (name === 'governance/internal_queries:getPolicyConfigInternal') {
        return null;
      }
      // An editor's run: the agent's full equipment.
      if (name === 'tasks/agent_runs:getTaskAgentRunAuthority') {
        return { confined: false };
      }
      // A live turn that still reads input: a steer may restart it.
      if (name === 'sandbox/session_queries:getOpSteerState') {
        return { status: 'running', finalized: false };
      }
      if (name === 'sandbox/session_queries:getSessionOpAttribution') {
        return { userId: 'user-starter' };
      }
      if (name === 'governance/queries:getContextCapInternal') return null;
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      mutations.push({ name, args });
      if (name === 'tasks/agent_runs:markTaskAgentRunFailed') {
        run.status = 'failed';
      }
      if (name === 'tasks/agent_runs:setTaskAgentRunRunning') {
        run.status = 'running';
        return true;
      }
      if (name === 'sandbox/session_mutations:reserveTurnBudget') {
        return { allowed: true, budgetCents: 500 };
      }
      if (name === 'tasks/agent_runs:rotateTaskAgentRunExec') {
        run.execId = 'exec-rotated';
        return { execId: 'exec-rotated' };
      }
      return null;
    },
    runAction: async () => null,
    scheduler: {
      runAfter: async () => 'job',
      runAt: async () => 'job',
      cancel: async () => undefined,
    },
  };
  return { ctx: ctx as never, mutations };
}

const KEYS = {
  organizationId: 'org-1',
  runId: 'run-old',
  taskId: 'task-1',
  agentId: 'alice',
  execId: 'exec-old',
  sessionId: 'pa-alice',
  harness: 'claude-code',
  deadlineAt: Date.now() + 60_000,
};

beforeEach(() => {
  io.cancels = [];
  io.cancelModes = [];
  io.statusPolls = [];
  io.starts = [];
  io.released = [];
  io.predecessorRunningPolls = 0;
  io.drainThrows = false;
  io.afterDrain = undefined;
  io.terminal = undefined;
  io.listings = [];
  io.deletes = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('drive window failure', () => {
  it('discards a terminal result when cancellation lands during the drain', async () => {
    const run: RunState = { status: 'running', execId: 'exec-old' };
    const { ctx, mutations } = makeCtx(run);
    io.afterDrain = () => {
      run.status = 'cancelled';
    };
    await driveTaskAgentTurnImpl(ctx, KEYS as never);
    expect(run.status).toBe('cancelled');
    expect(io.cancels).toEqual(['exec-old']);
    // A Stop ends everything the turn started.
    expect(io.cancelModes).toEqual([{}]);
    expect(io.released).toEqual([{ execId: 'exec-old', status: 'cancelled' }]);
    expect(
      mutations.some(
        (entry) => entry.name === 'tasks/agent_runs:completeTaskAgentRun',
      ),
    ).toBe(false);
    expect(
      mutations.some(
        (entry) => entry.name === 'tasks/internal_mutations:agentAddComment',
      ),
    ).toBe(false);
  });
  it('cancels the exec before settling the run as crashed', async () => {
    io.drainThrows = true;
    const run: RunState = { status: 'running', execId: 'exec-old' };
    const { ctx, mutations } = makeCtx(run);

    await driveTaskAgentTurnImpl(ctx, KEYS as never);

    expect(io.cancels).toEqual(['exec-old']);
    expect(io.cancelModes).toEqual([{}]);
    expect(run.status).toBe('failed');
    const failed = mutations.find((m) =>
      m.name.endsWith(':markTaskAgentRunFailed'),
    );
    expect(failed?.args.failureCode).toBe('turn_crashed');
    expect(failed?.args.error).toBe('the agent run stopped unexpectedly');
    // The cancel precedes the settle's key release.
    expect(io.released).toEqual([{ execId: 'exec-old', status: 'failed' }]);
  });
  it('names a full sandbox disk instead of an unexpected stop', async () => {
    io.drainThrows = 'disk-full';
    const run: RunState = { status: 'running', execId: 'exec-old' };
    const { ctx, mutations } = makeCtx(run);

    await driveTaskAgentTurnImpl(ctx, KEYS as never);

    expect(io.cancels).toEqual(['exec-old']);
    expect(run.status).toBe('failed');
    const failed = mutations.find((m) =>
      m.name.endsWith(':markTaskAgentRunFailed'),
    );
    expect(failed?.args.error).toBe(
      'the agent run stopped: the sandbox host ran out of disk space',
    );
    expect(failed?.args.failureCode).toBe('turn_crashed');
  });
});

describe('settle harvest', () => {
  const reported = (exited: boolean) => ({
    kind: 'terminal',
    text: 'Reviewed, nothing to change.',
    timeline: [],
    ended: {
      type: 'turn-ended',
      status: 'completed',
      finalText: 'Reviewed, nothing to change.',
    },
    exited,
  });

  it('takes the first empty listing of a turn whose exec exited on its own', async () => {
    io.terminal = reported(true);
    const run: RunState = { status: 'running', execId: 'exec-old' };
    const { ctx, mutations } = makeCtx(run);

    await driveTaskAgentTurnImpl(ctx, KEYS as never);

    expect(io.listings).toEqual(['/agent/output/task-1']);
    expect(
      mutations.some((m) => m.name.endsWith(':completeTaskAgentRun')),
    ).toBe(true);
  });

  it('re-reads an empty delivery box after a reaped linger', async () => {
    io.terminal = reported(false);
    const run: RunState = { status: 'running', execId: 'exec-old' };
    const { ctx, mutations } = makeCtx(run);

    await driveTaskAgentTurnImpl(ctx, KEYS as never);

    expect(io.listings).toEqual(Array(4).fill('/agent/output/task-1'));
    expect(
      mutations.some((m) => m.name.endsWith(':completeTaskAgentRun')),
    ).toBe(true);
  });
});

describe('a Gemini turn’s staged subscription credential', () => {
  const GEMINI = { ...KEYS, harness: 'gemini' };
  const CREDENTIAL = ['.runtime/home/.gemini/oauth_creds.json'];

  it('leaves the session when the turn settles', async () => {
    io.terminal = {
      kind: 'terminal',
      text: 'Done.',
      timeline: [],
      ended: { type: 'turn-ended', status: 'completed', finalText: 'Done.' },
      exited: true,
    };
    const run: RunState = { status: 'running', execId: 'exec-old' };
    const { ctx } = makeCtx(run);

    await driveTaskAgentTurnImpl(ctx, GEMINI as never);

    expect(io.deletes).toEqual([CREDENTIAL]);
  });

  it('leaves the session when a Stop orphans the turn', async () => {
    const run: RunState = { status: 'cancelled', execId: 'exec-old' };
    const { ctx } = makeCtx(run);

    await driveTaskAgentTurnImpl(ctx, GEMINI as never);

    expect(io.cancels).toEqual(['exec-old']);
    expect(io.deletes).toEqual([CREDENTIAL]);
  });

  it('stays for the exec a steer restarted the run onto', async () => {
    const run: RunState = { status: 'running', execId: 'exec-rotated' };
    const { ctx } = makeCtx(run);

    await driveTaskAgentTurnImpl(ctx, GEMINI as never);

    expect(io.cancels).toEqual(['exec-old']);
    expect(io.deletes).toEqual([]);
  });
});

describe('start after a harness switch', () => {
  it('reaps the predecessor and waits for it to be gone before launching', async () => {
    const run: RunState = { status: 'queued', execId: 'exec-new' };
    const { ctx } = makeCtx(run);
    // The old CLI is still inside its kill grace for two probes.
    io.predecessorRunningPolls = 2;

    await startTaskAgentTurnImpl(ctx, {
      ...KEYS,
      runId: 'run-new',
      execId: 'exec-new',
      harness: 'codex',
      model: 'gpt-5',
      modelProvider: 'openai',
      skills: [],
      connectors: [],
      tools: [],
      secrets: [],
      // The kick plan of a Claude→Codex switch: fresh conversation, the
      // failed predecessor's box kept, its exec named for the reap.
      predecessorExecId: 'exec-old',
      sweep: false,
      inspectNote: true,
    } as never);

    expect(io.cancels).toEqual(['exec-old']);
    // Two `running` answers, then `exited`.
    expect(io.statusPolls).toEqual(['exec-old', 'exec-old', 'exec-old']);
    expect(io.starts).toHaveLength(1);
    expect(io.starts[0]?.execId).toBe('exec-new');
    expect(io.starts[0]?.argv[0]).toBe('codex');
    expect(io.starts[0]?.argv).not.toContain('resume');
    expect(io.starts[0]?.stdin).toMatch(
      /could not be continued as the same conversation/,
    );
  }, 15_000);

  it('launches without a reap when the plan names no predecessor', async () => {
    const run: RunState = { status: 'queued', execId: 'exec-first' };
    const { ctx } = makeCtx(run);

    await startTaskAgentTurnImpl(ctx, {
      ...KEYS,
      runId: 'run-first',
      execId: 'exec-first',
      harness: 'codex',
      model: 'gpt-5',
      modelProvider: 'openai',
      skills: [],
      connectors: [],
      tools: [],
      secrets: [],
      sweep: true,
      inspectNote: false,
    } as never);

    expect(io.cancels).toEqual([]);
    expect(io.statusPolls).toEqual([]);
    expect(io.starts.map((s) => s.execId)).toEqual(['exec-first']);
  });
});

describe('steer restart', () => {
  it('cancels the old exec as a rotation, keeping the turn’s servers for the restarted turn', async () => {
    const run: RunState = { status: 'running', execId: 'exec-old' };
    const { ctx } = makeCtx(run);

    await steerTaskAgentTurnImpl(ctx, {
      ...KEYS,
      // A harness without live steering: the comment restarts the turn.
      harness: 'codex',
      model: 'gpt-5',
      modelProvider: 'openai',
      skills: [],
      connectors: [],
      tools: [],
      secrets: [],
      feedback: 'Check the staging site too.',
      author: 'Dana',
      authorId: 'user-dana',
      attempt: 0,
    } as never);

    expect(io.cancels).toEqual(['exec-old']);
    expect(io.cancelModes).toEqual([{ keepLeftovers: true }]);
    expect(io.starts.map((s) => s.execId)).toEqual(['exec-rotated']);
  });
});
