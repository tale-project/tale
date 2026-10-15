/**
 * Every turn of a task agent — a start and a steered restart — opens with its
 * project's instructions as they read when it starts, between the
 * organization's Custom instructions and the agent's own, and the run
 * records the digests of what the turn was handed. A turn whose project or
 * task cannot be read does not start. The test drives the REAL start and
 * steer hosts with only external I/O replaced, and reads the exec each one
 * builds.
 */

import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';

const io = vi.hoisted(() => ({
  /** Whether the run is confined, as the run ledger answers it. */
  confined: false,
  run: { status: 'queued', execId: 'exec-1', startedBy: 'user-starter' },
  /** The session-token rows the hosts wrote, by token hash. */
  tokens: new Map<string, Record<string, unknown>>(),
  /** What each exec was built from. */
  execs: [] as Record<string, unknown>[],
  /** The rotations a steer claimed. */
  rotations: [] as Record<string, unknown>[],
  /** Once set, the launch reads named here answer only after all of them
   * were asked — reads made one after another would never answer. */
  overlap: null as {
    asked: Set<string>;
    all: Promise<void>;
    release: () => void;
  } | null,
  /** The launch reads answered and the equipment resolved, in order. */
  events: [] as string[],
  armOverlap: false,
  /** The project block the snapshot answers; an Error fails the read. */
  projectBlock: null as string | Error | null,
  /** The snapshot reads the turns asked for. */
  snapshots: [] as Record<string, unknown>[],
  /** The failure a settled turn recorded. */
  failures: [] as Record<string, unknown>[],
}));

/** The reads a launch makes once its run is flipped running. */
const LAUNCH_READS = [
  'tasks/agent_runs:getTaskAgentRunAuthority',
  'tasks/agent_runs:getAgentLanguageContext',
  'governance/internal_queries:getPolicyConfigInternal',
];

const { resolveTurnEquipmentEnv } = vi.hoisted(() => ({
  resolveTurnEquipmentEnv: vi.fn(),
}));

vi.mock('../chat/external_turn_shared', async (importActual) => {
  const actual =
    await importActual<typeof import('../chat/external_turn_shared')>();
  return {
    ...actual,
    buildExternalTurnExec: (
      args: Parameters<typeof actual.buildExternalTurnExec>[0],
    ) => {
      io.execs.push(args as unknown as Record<string, unknown>);
      return actual.buildExternalTurnExec(args);
    },
    drainHarnessWindow: async () => ({
      kind: 'running',
      text: '',
      timeline: [],
    }),
  };
});
vi.mock('../automations/agent_host', () => ({
  liveProgressSink: () => ({
    onText() {},
    onTimeline() {},
    async flush() {},
  }),
  releaseTurnKey: async () => ({ won: true }),
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
    sessionCancelExec: async () => true,
    sessionExecStatus: async () => ({ state: 'exited', exitCode: 0 }),
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
    providerSlug: 'local-inference',
    modelId: 'qwen3-32b',
  }),
}));
vi.mock('../lib/providers/resolve_model', () => ({
  resolveModel: async () => {
    throw new Error('no catalog entry in this test');
  },
}));
vi.mock('../lib/providers/resolve_vision_model', () => ({
  resolveTurnVisionModel: async () => null,
}));
vi.mock('../node_only/sandbox/gateway_provisioning', () => ({
  provisionSessionGatewayKey: async () => ({
    token: 'vk-turn',
    keyId: 'id-vk-turn',
    keyHash: createHash('sha256').update('vk-turn').digest('hex'),
  }),
}));
vi.mock('../node_only/sandbox/turn_equipment', () => ({
  resolveConfinedTurnEnv: async () => ({}),
  resolveTurnEquipmentEnv,
}));

const { startTaskAgentTurnImpl, steerTaskAgentTurnImpl } =
  await import('./agent_run_host');

function makeCtx() {
  const run = io.run;
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = functionRefName(ref);
      const overlap = io.overlap;
      if (overlap !== null && LAUNCH_READS.includes(name)) {
        overlap.asked.add(name);
        if (overlap.asked.size === LAUNCH_READS.length) overlap.release();
        await Promise.race([
          overlap.all,
          new Promise((_resolve, reject) =>
            setTimeout(
              () => reject(new Error(`${name} was read on its own`)),
              2_000,
            ),
          ),
        ]);
        io.events.push(name);
      }
      if (name === 'tasks/agent_runs:getTaskAgentRunForDrive') {
        return {
          status: run.status,
          execId: run.execId,
          sessionId: 'pa-alice-m0123456789abcdef',
          organizationId: 'org-1',
        };
      }
      if (name === 'tasks/agent_runs:getTaskAgentRunAuthority') {
        return { confined: io.confined };
      }
      if (name === 'projects/internal_queries:getProjectAgentSkillScope') {
        return null;
      }
      if (name === 'tasks/agent_runs:getAgentLanguageContext') {
        return {
          defaultLocale: 'en',
          task: { id: 'task-1', title: 'Check the VAT run', description: null },
        };
      }
      if (name === 'tasks/agent_runs:getTaskBriefForAgentRun') {
        return {
          title: 'Check the VAT run',
          attachments: [],
          outputs: [],
          discussion: [],
        };
      }
      if (name === 'sandbox/session_queries:getOpSteerState') {
        return { status: 'running', finalized: false };
      }
      if (name === 'sandbox/session_queries:getSessionOpAttribution') {
        return { userId: run.startedBy };
      }
      if (name === 'governance/queries:getContextCapInternal') return null;
      // No Custom instructions in this organization.
      if (name === 'governance/internal_queries:getPolicyConfigInternal') {
        return null;
      }
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (name === 'sandbox/session_mutations:insertSessionToken') {
        io.tokens.set(String(args.tokenHash), args);
      }
      if (name === 'tasks/agent_runs:setTaskAgentRunRunning') {
        run.status = 'running';
        if (io.armOverlap) {
          let release = () => {};
          const all = new Promise<void>((resolve) => {
            release = resolve;
          });
          io.overlap = { asked: new Set(), all, release };
        }
        return true;
      }
      if (name === 'tasks/agent_runs:rotateTaskAgentRunExec') {
        io.rotations.push(args);
        run.execId = 'exec-rotated';
        return { execId: 'exec-rotated' };
      }
      if (name === 'sandbox/session_mutations:reserveTurnBudget') {
        return { allowed: true, budgetCents: 500 };
      }
      if (name === 'tasks/agent_runs:snapshotTaskAgentRunInstructions') {
        io.snapshots.push(args);
        if (io.projectBlock instanceof Error) throw io.projectBlock;
        return io.projectBlock;
      }
      if (name === 'tasks/agent_runs:markTaskAgentRunFailed') {
        io.failures.push(args);
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
  return ctx as never;
}

const KEYS = {
  organizationId: 'org-1',
  runId: 'run-1',
  taskId: 'task-1',
  agentId: 'alice',
  execId: 'exec-1',
  sessionId: 'pa-alice-m0123456789abcdef',
  harness: 'claude-code',
  deadlineAt: Date.now() + 60_000,
  model: 'qwen3-32b',
  modelProvider: 'local-inference',
  skills: [],
  connectors: ['github'],
  tools: ['task_update_status'],
  secrets: ['VAT_API_KEY'],
};

const STEER = {
  ...KEYS,
  harness: 'codex',
  feedback: 'Use last quarter’s figures too.',
  author: 'Dana',
  authorId: 'user-dana',
  attempt: 0,
};

function lastExec(): { instructions: string; extraEnv?: unknown } {
  const exec = io.execs.at(-1);
  if (exec === undefined) throw new Error('no exec was built');
  return exec as { instructions: string; extraEnv?: unknown };
}

beforeEach(() => {
  vi.clearAllMocks();
  io.confined = false;
  io.run = { status: 'queued', execId: 'exec-1', startedBy: 'user-starter' };
  io.tokens.clear();
  io.execs = [];
  io.rotations = [];
  io.overlap = null;
  io.armOverlap = false;
  io.events = [];
  io.projectBlock =
    'Instructions for project "Tale", as they read when this turn started. They apply to every task in the project and replace any earlier copy of them in this conversation:\nShip small, reviewed changes.';
  io.snapshots = [];
  io.failures = [];
  resolveTurnEquipmentEnv.mockResolvedValue({});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const AGENT_INSTRUCTIONS = 'You check the VAT run every quarter.';

describe('every task turn opens with its project’s current instructions, and its run records what it was handed [TASK-R49]', () => {
  it('hands a starting turn the project’s instructions before the agent’s own, and records them for its execution', async () => {
    await startTaskAgentTurnImpl(makeCtx(), {
      ...KEYS,
      instructions: AGENT_INSTRUCTIONS,
      sweep: true,
    } as never);

    const { instructions } = lastExec();
    const project = instructions.indexOf('Ship small, reviewed changes.');
    const agent = instructions.indexOf(AGENT_INSTRUCTIONS);
    expect(project).toBeGreaterThanOrEqual(0);
    expect(agent).toBeGreaterThan(project);
    expect(io.snapshots).toEqual([
      {
        organizationId: 'org-1',
        runId: 'run-1',
        taskId: 'task-1',
        execId: 'exec-1',
        agentInstructions: AGENT_INSTRUCTIONS,
      },
    ]);
  });

  it('reads them again for a steered restart, under its new execution', async () => {
    const ctx = makeCtx();
    await startTaskAgentTurnImpl(ctx, {
      ...KEYS,
      instructions: AGENT_INSTRUCTIONS,
      sweep: true,
    } as never);
    io.projectBlock =
      'Instructions for project "Tale", as they read when this turn started. They apply to every task in the project and replace any earlier copy of them in this conversation:\nShip small, reviewed changes. Never merge red.';
    await steerTaskAgentTurnImpl(ctx, {
      ...STEER,
      instructions: AGENT_INSTRUCTIONS,
    } as never);

    expect(lastExec().instructions).toContain(
      'Ship small, reviewed changes. Never merge red.',
    );
    expect(io.snapshots.at(-1)).toMatchObject({ execId: 'exec-rotated' });
  });

  it('opens without a project block when the project has no instructions', async () => {
    io.projectBlock = null;
    await startTaskAgentTurnImpl(makeCtx(), {
      ...KEYS,
      instructions: AGENT_INSTRUCTIONS,
      sweep: true,
    } as never);
    expect(lastExec().instructions).not.toContain('Instructions for project');
    expect(lastExec().instructions).toContain(AGENT_INSTRUCTIONS);
  });

  it('does not start a turn whose project or task cannot be read', async () => {
    io.projectBlock = new Error('the task is gone');
    await startTaskAgentTurnImpl(makeCtx(), {
      ...KEYS,
      instructions: AGENT_INSTRUCTIONS,
      sweep: true,
    } as never);
    expect(io.execs).toEqual([]);
    expect(io.failures).toHaveLength(1);
  });
});
