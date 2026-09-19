/**
 * The serving model's context window reaches every exec a task agent run
 * launches: the REAL start and steer hosts, with only external I/O replaced
 * and the model's catalog entry stubbed. Without it Claude Code assumes a
 * 200,000-token window for a model it does not know — a local model serving
 * 32,768 let a desk turn grow to ~140K before the CLI compacted, and the
 * prefill outlasted the CLI's own 30-minute stream watchdog.
 */

import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { resolveModel } from '../lib/providers/resolve_model';

const io = vi.hoisted(() => ({
  instructions: [] as string[],
  starts: [] as Array<{ execId: string; env: Record<string, string> }>,
  builds: [] as Array<{ execId: string; contextWindow?: number }>,
  /** The windows the drain answers, in order; `running` once they run out. */
  windows: [] as unknown[],
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
      io.builds.push({
        execId: args.execId,
        ...(args.contextWindow !== undefined
          ? { contextWindow: args.contextWindow }
          : {}),
      });
      return actual.buildExternalTurnExec(args);
    },
    drainHarnessWindow: async (args: {
      execId: string;
      start?: { env: Record<string, string> };
    }) => {
      if (args.start !== undefined) {
        io.starts.push({ execId: args.execId, env: args.start.env });
      }
      return io.windows.shift() ?? { kind: 'running', text: '', timeline: [] };
    },
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
  resolveModel: vi.fn(),
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

const { startTaskAgentTurnImpl, steerTaskAgentTurnImpl } =
  await import('./agent_run_host');

function servesWindow(contextWindow: number): void {
  const entry: ModelCatalogEntry = {
    id: 'qwen3-32b',
    provider: 'local-inference',
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    contextWindow,
  };
  vi.mocked(resolveModel).mockResolvedValue({
    entry,
    connector: { name: 'local-inference' } as never,
  });
}

interface RunState {
  status: string;
  execId: string;
}

function makeCtx(run: RunState, contextCap: number | null = null) {
  const queries: Array<{ name: string; args: Record<string, unknown> }> = [];
  const ctx = {
    runQuery: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      queries.push({ name, args });
      if (name === 'tasks/agent_runs:getTaskAgentRunForDrive') {
        return {
          ...run,
          sessionId: 'pa-alice',
          organizationId: 'org-1',
        };
      }
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
          title: 'Book the synthetic invoice',
          attachments: [],
          outputs: [],
          discussion: [],
        };
      }
      if (name === 'sandbox/session_queries:getOpSteerState') {
        return { status: 'running', finalized: false };
      }
      if (name === 'sandbox/session_queries:getSessionOpAttribution') {
        return { userId: 'user-starter' };
      }
      if (name === 'governance/queries:getContextCapInternal') {
        return contextCap;
      }
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown) => {
      const name = functionRefName(ref);
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
  return { ctx: ctx as never, queries };
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
  tools: [],
  secrets: [],
};

beforeEach(() => {
  io.starts = [];
  io.instructions = [];
  io.builds = [];
  io.windows = [];
  vi.mocked(resolveModel).mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a task agent start', () => {
  it('hands Claude Code the serving model’s window', async () => {
    servesWindow(32_768);
    const { ctx, queries } = makeCtx({ status: 'queued', execId: 'exec-1' });

    await startTaskAgentTurnImpl(ctx, { ...KEYS, sweep: true } as never);

    expect(io.starts).toHaveLength(1);
    expect(io.instructions[0]).toContain(
      'default agent language is French (fr)',
    );
    expect(io.instructions[0]).toContain('Unterlagen prüfen');
    expect(io.starts[0]?.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('32768');
    // The context limit is read for the run's starter, through this very
    // exec's op.
    expect(
      queries.find(
        (q) => q.name === 'sandbox/session_queries:getSessionOpAttribution',
      )?.args,
    ).toEqual({
      organizationId: 'org-1',
      sessionId: 'pa-alice',
      execId: 'exec-1',
      kind: 'task-agent',
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('narrows the window to the starter’s context limit', async () => {
    servesWindow(131_072);
    const { ctx } = makeCtx({ status: 'queued', execId: 'exec-1' }, 16_384);

    await startTaskAgentTurnImpl(ctx, { ...KEYS, sweep: true } as never);

    expect(io.starts[0]?.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('16384');
  });

  it('keeps the window when a dead resume handle relaunches fresh', async () => {
    servesWindow(32_768);
    const { ctx } = makeCtx({ status: 'queued', execId: 'exec-1' });
    // The CLI launched with a dead handle: one errored result, no content.
    io.windows = [
      {
        kind: 'terminal',
        text: '',
        timeline: [],
        ended: { type: 'turn-ended', status: 'completed', isError: true },
        exited: true,
      },
    ];

    await startTaskAgentTurnImpl(ctx, {
      ...KEYS,
      resume: 'dead-conversation',
      resumeSessionCreatedAt: 1000,
      sweep: false,
    } as never);

    expect(io.starts.map((s) => s.execId)).toEqual(['exec-1', 'exec-1']);
    for (const start of io.starts) {
      expect(start.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('32768');
    }
  });

  it('still launches, and leaves the CLI to decide, without a catalog entry', async () => {
    vi.mocked(resolveModel).mockRejectedValue(
      new Error('No model "qwen3-32b" is available in this organization.'),
    );
    const { ctx } = makeCtx({ status: 'queued', execId: 'exec-1' });

    await startTaskAgentTurnImpl(ctx, { ...KEYS, sweep: true } as never);

    expect(io.starts).toHaveLength(1);
    expect(io.instructions[0]).toContain(
      'default agent language is French (fr)',
    );
    expect(io.instructions[0]).toContain('Unterlagen prüfen');
    expect(io.starts[0]?.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('');
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('a task agent steer restart', () => {
  it('carries the window into the restarted exec', async () => {
    servesWindow(32_768);
    // Codex has no stdin steering, so a comment restarts its process.
    const { ctx, queries } = makeCtx({ status: 'running', execId: 'exec-1' });

    await steerTaskAgentTurnImpl(ctx, {
      ...KEYS,
      harness: 'codex',
      model: 'qwen3-32b',
      feedback: 'Use the second address.',
      author: 'Dana',
      authorId: 'user-dana',
      attempt: 0,
    } as never);

    expect(io.builds).toEqual([
      { execId: 'exec-rotated', contextWindow: 32_768 },
    ]);
    expect(io.starts.map((s) => s.execId)).toEqual(['exec-rotated']);
    expect(
      queries.find(
        (q) => q.name === 'sandbox/session_queries:getSessionOpAttribution',
      )?.args,
    ).toMatchObject({ execId: 'exec-rotated', kind: 'task-agent' });
    expect(console.error).not.toHaveBeenCalled();
  });
});
