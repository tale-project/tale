// @vitest-environment node

/**
 * The serving model's context window reaches every exec an automation agent
 * node launches — the kick's scheduled start and the answered-ask resume —
 * through the REAL hosts, with only external I/O replaced and the model's
 * catalog entry stubbed. Without it Claude Code assumes a 200,000-token
 * window for a model it does not know, and a turn on a local model serving
 * 32,768 grows far past what that model can prefill in time.
 */

import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import type { ActionCtx } from '../lib/ctx';
import { resolveModel } from '../lib/providers/resolve_model';

const io = vi.hoisted(() => ({
  instructions: [] as string[],
  starts: [] as Array<{ execId: string; env: Record<string, string> }>,
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
    drainHarnessWindow: async (args: {
      execId: string;
      start?: { env: Record<string, string> };
    }) => {
      if (args.start !== undefined) {
        io.starts.push({ execId: args.execId, env: args.start.env });
      }
      return { kind: 'running', text: '', timeline: [] };
    },
  };
});
vi.mock('../lib/providers/resolve_model', () => ({
  resolveModel: vi.fn(),
}));
vi.mock('../lib/providers/agent_serving', () => ({
  resolveWorkflowAgentServing: async () => ({
    lane: 'gateway',
    providerSlug: 'local-inference',
    modelId: 'qwen3-32b',
  }),
}));
vi.mock('../lib/providers/resolve_vision_model', () => ({
  resolveTurnVisionModel: async () => null,
}));
vi.mock('../node_only/sandbox/agent_session', () => ({
  ensureAgentSession: async () => ({ liveCreatedAt: 1000 }),
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

const { resumeWorkflowAgentTurnWithAnswerImpl, startWorkflowAgentTurnImpl } =
  await import('./agent_host');

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

const ASK = {
  _id: 'ask-1',
  runId: 'run-1',
  nodeId: 'book',
  execId: 'exec-asking',
  question: 'Which cost centre?',
  expiresAt: Date.now() + 60_000,
  status: 'answered',
  answer: 'Cost centre 4711.',
  agentSessionId: 'claude-session-1',
};

/** A run whose cursor waits on the asking exec of node `book`. */
const WAITING_CURSOR = {
  status: 'waiting',
  cursor: {
    node: 'book',
    agent: {
      execId: 'exec-asking',
      sessionId: 'wf-run-1',
      deadlineAt: Date.now() + 60_000,
      providerSlug: 'local-inference',
      gatewayModel: 'local-inference-org-1/qwen3-32b',
      harness: 'claude-code',
      input: {
        model: 'qwen3-32b',
        modelProvider: 'local-inference',
        prompt: 'Book the synthetic invoice.',
      },
    },
  },
};

function makeCtx(cursor: unknown) {
  const queries: Array<{ name: string; args: Record<string, unknown> }> = [];
  const scheduled: string[] = [];
  const ctx = {
    runQuery: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      queries.push({ name, args });
      switch (name) {
        case 'automations/queries:readAgentCursor':
          return cursor;
        case 'automations/queries:getRunLanguageContext':
          return {
            defaultLocale: 'de',
            task: { id: 'task-1', title: '2026 Q1', description: null },
          };
        case 'automations/queries:getRunProjectId':
          return null;
        case 'automations/human_asks:listAnsweredAsksForNode':
          return [];
        case 'automations/human_asks:getAskForResume':
          return ASK;
        case 'sandbox/session_queries:getSessionOpAttribution':
          return { userId: 'user-starter', agentSlug: 'invoice-desk' };
        case 'governance/queries:getContextCapInternal':
          return null;
        default:
          throw new Error(`unexpected query ${name}`);
      }
    },
    runMutation: async (ref: unknown) => {
      const name = functionRefName(ref);
      if (name === 'sandbox/session_mutations:reserveTurnBudget') {
        return { allowed: true, budgetCents: 500 };
      }
      if (name === 'automations/human_asks:retargetAgentCursor') {
        return { retargeted: true };
      }
      return null;
    },
    runAction: async (ref: unknown) => {
      throw new Error(`unexpected action ${functionRefName(ref)}`);
    },
    scheduler: {
      runAfter: async (_delay: number, ref: unknown) => {
        scheduled.push(functionRefName(ref));
        return 'job';
      },
    },
  } as unknown as ActionCtx;
  return { ctx, queries, scheduled };
}

beforeEach(() => {
  io.starts = [];
  io.instructions = [];
  vi.mocked(resolveModel).mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('an automation agent turn', () => {
  it('starts Claude Code with the serving model’s window', async () => {
    servesWindow(32_768);
    const { ctx, queries, scheduled } = makeCtx({ status: 'running' });

    await startWorkflowAgentTurnImpl(ctx, {
      organizationId: 'org-1',
      runId: 'run-1',
      nodeId: 'book',
      execId: 'exec-1',
      sessionId: 'wf-run-1',
      harness: 'claude-code',
      lane: 'gateway',
      providerSlug: 'local-inference',
      modelId: 'qwen3-32b',
      gatewayModel: 'local-inference-org-1/qwen3-32b',
      deadlineAt: Date.now() + 60_000,
      request: { model: 'qwen3-32b', prompt: 'Book the synthetic invoice.' },
    } as never);

    expect(console.error).not.toHaveBeenCalled();
    expect(io.starts).toHaveLength(1);
    expect(io.instructions[0]).toContain(
      'default agent language is German (de)',
    );
    expect(io.instructions[0]).toContain('including ask_human');
    expect(io.instructions[0]).toContain('2026 Q1');
    expect(io.starts[0]?.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('32768');
    // The serving connector's entry, and the starter's limit through this
    // exec's op.
    expect(resolveModel).toHaveBeenCalledExactlyOnceWith(
      ctx,
      'org-1',
      'qwen3-32b',
      'local-inference',
      true,
    );
    expect(
      queries.find(
        (q) => q.name === 'sandbox/session_queries:getSessionOpAttribution',
      )?.args,
    ).toEqual({
      organizationId: 'org-1',
      sessionId: 'wf-run-1',
      execId: 'exec-1',
      kind: 'workflow-agent',
    });
    // The turn went on to its drive window.
    expect(scheduled).toEqual([
      'automations/agent_host:driveWorkflowAgentTurn',
    ]);
  });

  it('resumes after an answer with the window re-resolved', async () => {
    servesWindow(65_536);
    const { ctx, queries } = makeCtx(WAITING_CURSOR);

    await resumeWorkflowAgentTurnWithAnswerImpl(ctx, {
      organizationId: 'org-1',
      askId: 'ask-1',
    } as never);

    expect(console.error).not.toHaveBeenCalled();
    expect(io.starts).toHaveLength(1);
    expect(io.instructions[0]).toContain(
      'default agent language is German (de)',
    );
    expect(io.instructions[0]).toContain('including ask_human');
    expect(io.instructions[0]).toContain('2026 Q1');
    const resumed = io.starts[0];
    expect(resumed?.execId).not.toBe('exec-asking');
    expect(resumed?.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('65536');
    expect(
      queries.find(
        (q) => q.name === 'sandbox/session_queries:getSessionOpAttribution',
      )?.args,
    ).toEqual({
      organizationId: 'org-1',
      sessionId: 'wf-run-1',
      execId: resumed?.execId,
      kind: 'workflow-agent',
    });
  });
});
