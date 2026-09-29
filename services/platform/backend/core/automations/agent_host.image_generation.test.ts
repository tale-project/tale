// @vitest-environment node

/**
 * An automation agent node gets `generate_image` — the grant on its session
 * token, the op the images are booked and delivered for, and the one
 * instruction line that names the tool — only on a harness that mounts the
 * platform bridge, while the organization's image generation policy is on
 * AND a model resolves, on its first start and on the resume after an
 * answered question alike. The REAL hosts run with
 * only external I/O replaced and the image-model resolution stubbed.
 */

import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import type { ActionCtx } from '../lib/ctx';
import { resolveTurnImageGeneration } from '../lib/providers/resolve_image_model';
import { resolveModel } from '../lib/providers/resolve_model';

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
vi.mock('../lib/providers/resolve_image_model', () => ({
  resolveTurnImageGeneration: vi.fn(),
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

const ASK = {
  _id: 'ask-1',
  runId: 'run-1',
  nodeId: 'draw',
  execId: 'exec-asking',
  question: 'Which colour?',
  expiresAt: Date.now() + 60_000,
  status: 'answered',
  answer: 'Blue.',
  agentSessionId: 'claude-session-1',
};

const WAITING_CURSOR = {
  status: 'waiting',
  cursor: {
    node: 'draw',
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
        prompt: 'Draw the campaign visual.',
        tools: ['task_find'],
      },
    },
  },
};

function makeCtx(cursor: unknown) {
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = functionRefName(ref);
      switch (name) {
        case 'automations/queries:readAgentCursor':
          return cursor;
        case 'automations/queries:getRunLanguageContext':
          return { defaultLocale: 'en', task: null };
        case 'automations/queries:getRunProjectContext':
          return { project: null, boundProjects: [], bound: false };
        case 'automations/queries:getRunProjectId':
          return null;
        case 'automations/human_asks:listAnsweredAsksForNode':
          return [];
        case 'automations/human_asks:getAskForResume':
          return ASK;
        case 'sandbox/session_queries:getSessionOpAttribution':
          return { userId: 'user-starter', agentSlug: 'campaigns/visual' };
        case 'governance/queries:getContextCapInternal':
          return null;
        case 'governance/internal_queries:getPolicyConfigInternal':
          return null;
        default:
          throw new Error(`unexpected query ${name}`);
      }
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (name === 'sandbox/session_mutations:insertSessionToken') {
        io.tokens.push(args);
      }
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
    scheduler: { runAfter: async () => 'job' },
  } as unknown as ActionCtx;
  return ctx;
}

const START = {
  organizationId: 'org-1',
  runId: 'run-1',
  nodeId: 'draw',
  execId: 'exec-1',
  sessionId: 'wf-run-1',
  harness: 'claude-code',
  lane: 'gateway',
  providerSlug: 'local-inference',
  modelId: 'qwen3-32b',
  gatewayModel: 'local-inference-org-1/qwen3-32b',
  deadlineAt: Date.now() + 60_000,
  request: {
    model: 'qwen3-32b',
    prompt: 'Draw the campaign visual.',
    tools: ['task_find'],
  },
};

const PICK = {
  providerSlug: 'openai',
  modelId: 'gpt-image-1-mini',
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
  const entry: ModelCatalogEntry = {
    id: 'qwen3-32b',
    provider: 'local-inference',
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 32_768,
  };
  vi.mocked(resolveModel).mockResolvedValue({
    entry,
    connector: { name: 'local-inference' } as never,
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('image generation on an automation agent node', () => {
  it('is absent — no grant, no turn op, no instruction — while the policy offers none', async () => {
    vi.mocked(resolveTurnImageGeneration).mockResolvedValue(null);
    await startWorkflowAgentTurnImpl(
      makeCtx({ status: 'running' }),
      START as never,
    );
    expect(scopeOf(0).toolGrants).toEqual([
      'ask_human',
      'rag_search',
      'rag_fetch',
      'task_find',
    ]);
    expect(scopeOf(0)).not.toHaveProperty('turnOp');
    expect(io.instructions[0]).not.toContain('generate_image');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('is granted with the turn op and named once while a model resolves', async () => {
    vi.mocked(resolveTurnImageGeneration).mockResolvedValue(PICK);
    await startWorkflowAgentTurnImpl(
      makeCtx({ status: 'running' }),
      START as never,
    );
    expect(scopeOf(0).toolGrants).toEqual([
      'ask_human',
      'rag_search',
      'rag_fetch',
      'task_find',
      'generate_image',
    ]);
    expect(scopeOf(0).turnOp).toEqual({
      kind: 'workflow-agent',
      execId: 'exec-1',
    });
    const instructions = io.instructions[0] ?? '';
    expect(instructions.split('tool: "generate_image"')).toHaveLength(2);
    expect(instructions).toContain('saves them into /agent/output/');
    // The delivery sentence the step always carried is unchanged.
    expect(instructions).toContain(
      "Write every file you produce to /agent/output/ — files there are collected when your turn ends and become this step's output.",
    );
  });

  it('is re-decided for the resume after an answer, bound to the resumed exec', async () => {
    vi.mocked(resolveTurnImageGeneration).mockResolvedValue(PICK);
    await resumeWorkflowAgentTurnWithAnswerImpl(makeCtx(WAITING_CURSOR), {
      organizationId: 'org-1',
      askId: 'ask-1',
    } as never);
    const turnOp = scopeOf(0).turnOp as { kind: string; execId: string };
    expect(turnOp.kind).toBe('workflow-agent');
    expect(turnOp.execId).not.toBe('exec-asking');
    expect(scopeOf(0).toolGrants).toContain('generate_image');
    expect(io.instructions[0]).toContain('tool: "generate_image"');
  });

  it('is never offered on a harness that mounts no bridge to call it through', async () => {
    vi.mocked(resolveTurnImageGeneration).mockResolvedValue(PICK);
    await startWorkflowAgentTurnImpl(makeCtx({ status: 'running' }), {
      ...START,
      harness: 'pi',
    } as never);
    expect(resolveTurnImageGeneration).not.toHaveBeenCalled();
    expect(scopeOf(0).toolGrants).not.toContain('generate_image');
    expect(scopeOf(0)).not.toHaveProperty('turnOp');
    expect(io.instructions[0]).not.toContain('generate_image');
  });
});
