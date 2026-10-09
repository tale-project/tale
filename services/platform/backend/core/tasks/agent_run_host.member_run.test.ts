/**
 * A project agent's run that a member started — someone who may work their
 * own tasks but not edit the project — holds none of the agent's
 * credentials: its secrets and the GitHub token stay out of the sandbox,
 * and the turn is told so, by name, with what to do instead (an editor
 * starts the agent when the work needs them). A run an editor started gets
 * them as before. The test drives the REAL start and steer hosts with only
 * external I/O replaced, and reads the exec each one builds. A launch asks
 * for its instructions, confinement and language together, and resolves
 * the credentials only once all of them answered.
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
  resolveTurnEquipmentEnv.mockResolvedValue({
    VAT_API_KEY: 'vat-secret',
    GITHUB_TOKEN: 'gh-token',
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('a run a member started', () => {
  it('launches without the agent’s secrets or the GitHub token, and says why', async () => {
    io.confined = true;
    await startTaskAgentTurnImpl(makeCtx(), { ...KEYS, sweep: true } as never);

    expect(resolveTurnEquipmentEnv).not.toHaveBeenCalled();
    const exec = lastExec();
    expect(exec.extraEnv).toBeUndefined();
    expect(exec.instructions).toContain(
      'This run was started by a member who can work only their own task.',
    );
    expect(exec.instructions).toContain('(VAT_API_KEY, GITHUB_TOKEN)');
    expect(exec.instructions).toContain('an editor has to start the agent');
    expect(exec.instructions).not.toContain(
      'Credentials for this run are provided',
    );
    // Its workspace is one of the member's own workers.
    expect(exec.instructions).toContain(
      'is kept for the runs this member starts with you; their other runs work in workspaces of their own',
    );
  });

  it('names its run in its token, so the tool door can hold it to its task', async () => {
    io.confined = true;
    await startTaskAgentTurnImpl(makeCtx(), { ...KEYS, sweep: true } as never);
    const [row] = [...io.tokens.values()];
    expect(row?.scope).toMatchObject({ taskRun: { execId: 'exec-1' } });
  });

  it('restarts a steered turn without them either, booked to the person who steered', async () => {
    io.confined = true;
    const ctx = makeCtx();
    await startTaskAgentTurnImpl(ctx, { ...KEYS, sweep: true } as never);
    await steerTaskAgentTurnImpl(ctx, STEER as never);

    expect(io.rotations).toEqual([
      expect.objectContaining({ startedBy: 'user-dana' }),
    ]);
    expect(resolveTurnEquipmentEnv).not.toHaveBeenCalled();
    expect(lastExec().extraEnv).toBeUndefined();
    expect(lastExec().instructions).toContain('started by a member');
  });
});

describe('a run an editor started', () => {
  it('launches with the agent’s equipment, as before', async () => {
    await startTaskAgentTurnImpl(makeCtx(), { ...KEYS, sweep: true } as never);

    expect(resolveTurnEquipmentEnv).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      sessionId: KEYS.sessionId,
      connectors: ['github'],
      secrets: ['VAT_API_KEY'],
    });
    const exec = lastExec();
    expect(exec.extraEnv).toEqual({
      VAT_API_KEY: 'vat-secret',
      GITHUB_TOKEN: 'gh-token',
    });
    expect(exec.instructions).toContain(
      'Credentials for this run are provided',
    );
    expect(exec.instructions).not.toContain('started by a member');
    // Its workspace is its worker's own; other copies work other tasks.
    expect(exec.instructions).toContain(
      'belongs to this worker: other copies of you work other tasks at the same time in workspaces of their own',
    );
  });
});

describe('a launch', () => {
  it('reads its instructions, confinement and language together, and resolves credentials only after them', async () => {
    io.armOverlap = true;
    resolveTurnEquipmentEnv.mockImplementation(async () => {
      io.events.push('equipment');
      return { VAT_API_KEY: 'vat-secret' };
    });

    await startTaskAgentTurnImpl(makeCtx(), { ...KEYS, sweep: true } as never);

    expect(io.events.slice(0, LAUNCH_READS.length).sort()).toEqual(
      [...LAUNCH_READS].sort(),
    );
    expect(io.events.at(-1)).toBe('equipment');
    expect(lastExec().extraEnv).toEqual({ VAT_API_KEY: 'vat-secret' });
  });
});
