/**
 * A task run gets `generate_image` — the grant on its session token, the op
 * the images are booked and delivered for, and the one instruction line
 * that names the tool — only on a harness that mounts the platform bridge,
 * while the organization's image generation policy is on AND a model
 * resolves. Otherwise the tool is absent, and so is any mention of it. The
 * REAL start and steer hosts run with only external I/O replaced and the
 * image-model resolution stubbed.
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

const PICK = {
  providerSlug: 'openrouter',
  modelId: 'google/gemini-2.5-flash-image',
  source: 'preferred',
} as const;

function scopeOf(index: number): Record<string, unknown> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the host writes the scope as a plain record
  return io.tokens[index]?.scope as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  io.instructions = [];
  io.tokens = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('image generation on a task run', () => {
  it('is absent — no grant, no turn op, no instruction — while the policy offers none', async () => {
    vi.mocked(resolveTurnImageGeneration).mockResolvedValue(null);
    await startTaskAgentTurnImpl(
      makeCtx({ status: 'queued', execId: 'exec-1' }),
      { ...KEYS, sweep: true } as never,
    );
    expect(resolveTurnImageGeneration).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
    );
    expect(scopeOf(0).toolGrants).toEqual([
      'rag_search',
      'rag_fetch',
      'task_find',
    ]);
    expect(scopeOf(0)).not.toHaveProperty('turnOp');
    expect(io.instructions[0]).not.toContain('generate_image');
  });

  it('is granted with the turn op and named once while a model resolves', async () => {
    vi.mocked(resolveTurnImageGeneration).mockResolvedValue(PICK);
    await startTaskAgentTurnImpl(
      makeCtx({ status: 'queued', execId: 'exec-1' }),
      { ...KEYS, sweep: true } as never,
    );
    expect(scopeOf(0).toolGrants).toEqual([
      'rag_search',
      'rag_fetch',
      'task_find',
      'generate_image',
    ]);
    expect(scopeOf(0).turnOp).toEqual({
      kind: 'task-agent',
      execId: 'exec-1',
    });
    const instructions = io.instructions[0] ?? '';
    expect(instructions.split('tool: "generate_image"')).toHaveLength(2);
    expect(instructions).toContain('saves them into /agent/output/task-1/');
  });

  it('is re-decided for a steer restart, bound to the rotated exec', async () => {
    vi.mocked(resolveTurnImageGeneration).mockResolvedValue(PICK);
    await steerTaskAgentTurnImpl(
      makeCtx({ status: 'running', execId: 'exec-1' }),
      {
        ...KEYS,
        harness: 'codex',
        feedback: 'Use the blue logo.',
        author: 'Dana',
        authorId: 'user-dana',
        attempt: 0,
      } as never,
    );
    expect(scopeOf(0).turnOp).toEqual({
      kind: 'task-agent',
      execId: 'exec-rotated',
    });
    expect(io.instructions[0]).toContain('tool: "generate_image"');

    vi.mocked(resolveTurnImageGeneration).mockResolvedValue(null);
    await steerTaskAgentTurnImpl(
      makeCtx({ status: 'running', execId: 'exec-1' }),
      {
        ...KEYS,
        harness: 'codex',
        feedback: 'Now without images.',
        author: 'Dana',
        authorId: 'user-dana',
        attempt: 0,
      } as never,
    );
    expect(scopeOf(1).toolGrants).not.toContain('generate_image');
    expect(io.instructions[1]).not.toContain('generate_image');
  });

  it.each(['pi', 'hermes'])(
    'is never offered on %s, a harness that mounts no bridge to call it through',
    async (harness) => {
      vi.mocked(resolveTurnImageGeneration).mockResolvedValue(PICK);
      await startTaskAgentTurnImpl(
        makeCtx({ status: 'queued', execId: 'exec-1' }),
        { ...KEYS, harness, sweep: true } as never,
      );
      expect(resolveTurnImageGeneration).not.toHaveBeenCalled();
      expect(scopeOf(0).toolGrants).not.toContain('generate_image');
      expect(scopeOf(0)).not.toHaveProperty('turnOp');
      expect(io.instructions[0]).not.toContain('generate_image');
    },
  );
});
