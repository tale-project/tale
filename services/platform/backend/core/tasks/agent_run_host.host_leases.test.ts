/**
 * A task run gets the heavy-phase lease pair — the two grants on its session
 * token and the one instruction paragraph that names them — on a harness
 * that mounts the platform bridge, at its start and at a steer restart
 * alike. A harness without the bridge could not call them: there the tools
 * are absent, and so is any mention of them. The REAL start and steer hosts
 * run with only external I/O replaced.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { resolveTurnImageGeneration } from '../lib/providers/resolve_image_model';

const io = vi.hoisted(() => ({
  instructions: [] as string[],
  tokens: [] as Array<Record<string, unknown>>,
}));

vi.mock('../chat/external_turn_shared', async (importActual) => {
  const actual =
    await importActual<typeof import('../chat/external_turn_shared')>();
  return {
    ...actual,
    buildExternalTurnExec: (
      args: Parameters<typeof actual.buildExternalTurnExec>[0],
    ) => {
      io.instructions.push(args.instructions);
      return actual.buildExternalTurnExec(args);
    },
    drainHarnessWindow: async () => ({
      kind: 'running',
      text: '',
      timeline: [],
    }),
    resolveHarnessTurnContextWindow: async () => undefined,
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
vi.mock('../lib/providers/resolve_vision_model', () => ({
  resolveTurnVisionModel: async () => null,
}));
vi.mock('../lib/providers/resolve_image_model', () => ({
  resolveTurnImageGeneration: vi.fn(),
}));
vi.mock('../node_only/sandbox/gateway_provisioning', () => ({
  provisionSessionGatewayKey: async () => ({
    token: 'test-token',
    keyId: 'key-new',
    keyHash: 'hash-new',
  }),
}));
vi.mock('../node_only/sandbox/turn_equipment', () => ({
  resolveConfinedTurnEnv: () => ({}),
  resolveTurnEquipmentEnv: async () => ({}),
}));

const { startTaskAgentTurnImpl, steerTaskAgentTurnImpl } =
  await import('./agent_run_host');

function makeCtx(run: { status: string; execId: string }) {
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = functionRefName(ref);
      if (name === 'tasks/agent_runs:getTaskAgentRunForDrive') {
        return { ...run, sessionId: 'pa-alice', organizationId: 'org-1' };
      }
      // An editor's run: the agent's full equipment.
      if (name === 'tasks/agent_runs:getTaskAgentRunAuthority') {
        return { confined: false };
      }
      if (name === 'projects/internal_queries:getProjectAgentSkillScope') {
        return null;
      }
      if (name === 'tasks/agent_runs:getAgentLanguageContext') {
        return {
          defaultLocale: 'en',
          task: { id: 'task-1', title: 'Launch poster', description: null },
        };
      }
      if (name === 'tasks/agent_runs:getTaskBriefForAgentRun') {
        return {
          title: 'Launch poster',
          attachments: [],
          outputs: [],
          discussion: [],
        };
      }
      if (name === 'sandbox/session_queries:getOpSteerState') {
        return { status: 'running', finalized: false };
      }
      if (name === 'governance/internal_queries:getPolicyConfigInternal') {
        return null;
      }
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (name === 'sandbox/session_mutations:insertSessionToken') {
        io.tokens.push(args);
      }
      if (name === 'tasks/agent_runs:setTaskAgentRunRunning') {
        run.status = 'running';
        return true;
      }
      if (name === 'tasks/agent_runs:rotateTaskAgentRunExec') {
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
  sessionId: 'pa-alice',
  harness: 'claude-code',
  deadlineAt: Date.now() + 60_000,
  model: 'qwen3-32b',
  modelProvider: 'local-inference',
  skills: [],
  connectors: [],
  tools: ['task_find'],
  secrets: [],
};

function scopeOf(index: number): Record<string, unknown> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the host writes the scope as a plain record
  return io.tokens[index]?.scope as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  io.instructions = [];
  io.tokens = [];
  vi.mocked(resolveTurnImageGeneration).mockResolvedValue(null);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const STEER = {
  ...KEYS,
  harness: 'codex',
  feedback: 'Run the whole suite once more.',
  author: 'Dana',
  authorId: 'user-dana',
  attempt: 0,
};

describe('heavy-phase leases on a task run', () => {
  it('are granted and named once where the harness mounts the bridge [SBX-R28]', async () => {
    await startTaskAgentTurnImpl(
      makeCtx({ status: 'queued', execId: 'exec-1' }),
      { ...KEYS, sweep: true } as never,
    );
    expect(scopeOf(0).toolGrants).toEqual(
      expect.arrayContaining(['host_lease_acquire', 'host_lease_release']),
    );
    const instructions = io.instructions[0] ?? '';
    expect(instructions.split('tool: "host_lease_acquire"')).toHaveLength(2);
    expect(instructions).toContain('wait retryAfterSeconds and ask again');
    expect(instructions).toContain('"unavailable"');
  });

  it('stay with a steer restart, bound to the rotated exec [SBX-R28]', async () => {
    await steerTaskAgentTurnImpl(
      makeCtx({ status: 'running', execId: 'exec-1' }),
      STEER as never,
    );
    expect(scopeOf(0).taskRun).toEqual({ execId: 'exec-rotated' });
    expect(scopeOf(0).toolGrants).toEqual(
      expect.arrayContaining(['host_lease_acquire', 'host_lease_release']),
    );
    expect(io.instructions[0]).toContain('tool: "host_lease_acquire"');
  });

  it.each(['pi', 'hermes'])(
    'are never offered on %s, a harness that mounts no bridge to call them through [SBX-R28]',
    async (harness) => {
      await startTaskAgentTurnImpl(
        makeCtx({ status: 'queued', execId: 'exec-1' }),
        { ...KEYS, harness, sweep: true } as never,
      );
      expect(scopeOf(0).toolGrants).not.toContain('host_lease_acquire');
      expect(scopeOf(0).toolGrants).not.toContain('host_lease_release');
      expect(io.instructions[0]).not.toContain('host_lease');
    },
  );
});
