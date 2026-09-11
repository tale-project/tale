/**
 * Process hygiene around a failed drain and a retry: the REAL drive and start
 * hosts with only external I/O replaced.
 *
 *  - a drive window whose drain dies (an exhausted re-attach budget, a 502
 *    storm) settles the run failed — and must cancel the exec first, since
 *    the CLI is typically still alive and would keep working unobserved;
 *  - a start with a predecessor exec — here a Claude→Codex switch, so no
 *    resume — reaps it and waits until runnerd reports it gone BEFORE the
 *    new CLI launches on the same workspace and delivery box.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';

const io = vi.hoisted(() => ({
  cancels: [] as string[],
  statusPolls: [] as string[],
  starts: [] as Array<{ execId: string; argv: string[]; stdin?: string }>,
  released: [] as Array<{ execId: string; status: string }>,
  /** How many status probes still answer `running` for the predecessor. */
  predecessorRunningPolls: 0,
  drainThrows: false,
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
      if (io.drainThrows) {
        throw new Error('sandbox session attach failed (502)');
      }
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
  workflowAgentBudgetCents: () => 500,
}));
vi.mock('../node_only/sandbox/helpers/session_client', async (importActual) => {
  const actual =
    await importActual<
      typeof import('../node_only/sandbox/helpers/session_client')
    >();
  return {
    ...actual,
    sessionCancelExec: async (_sessionId: string, execId: string) => {
      io.cancels.push(execId);
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
    sessionDeleteFiles: async () => undefined,
    sessionListFiles: async () => [],
    sessionStageFiles: async () => ({ staged: [], skipped: [] }),
  };
});
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

const { driveTaskAgentTurnImpl, startTaskAgentTurnImpl } =
  await import('./agent_run_host');

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
      if (name === 'tasks/agent_runs:getTaskBriefForAgentRun') {
        return {
          title: 'Continue draft',
          attachments: [],
          outputs: [],
          discussion: [],
        };
      }
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
  io.statusPolls = [];
  io.starts = [];
  io.released = [];
  io.predecessorRunningPolls = 0;
  io.drainThrows = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('drive window failure', () => {
  it('cancels the exec before settling the run as crashed', async () => {
    io.drainThrows = true;
    const run: RunState = { status: 'running', execId: 'exec-old' };
    const { ctx, mutations } = makeCtx(run);

    await driveTaskAgentTurnImpl(ctx, KEYS as never);

    expect(io.cancels).toEqual(['exec-old']);
    expect(run.status).toBe('failed');
    const failed = mutations.find((m) =>
      m.name.endsWith(':markTaskAgentRunFailed'),
    );
    expect(failed?.args.failureCode).toBe('turn_crashed');
    // The cancel precedes the settle's key release.
    expect(io.released).toEqual([{ execId: 'exec-old', status: 'failed' }]);
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
