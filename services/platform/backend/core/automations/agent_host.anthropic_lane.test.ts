// @vitest-environment node

/**
 * A Claude Code turn on a connector that declares a native Anthropic harness
 * endpoint (DeepSeek) rides that endpoint's distinct `…__anthropic` gateway
 * record on EVERY exec an automation agent node launches — the kick's
 * scheduled start, the start's key mint, and the answered-ask resume — never
 * the OpenAI record the gateway would down-convert Anthropic→OpenAI for. The
 * task lane has threaded the lane since #3320; this locks the workflow lane
 * to the same routing through the REAL hosts, with only external I/O
 * replaced.
 *
 * Observed live (2026-09-20, vat-return-desk `repair_setup`): the serving
 * resolver returned the lane, the host dropped it, the session rode
 * `<org>__deepseek__deepseek-flash` and DeepSeek 400'd the down-converted
 * traffic — `reasoning_content` replay on every fresh session's second call,
 * then a PDF `document` block as a `file` part — until the retries ran out.
 */

import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import type { ActionCtx } from '../lib/ctx';
import { resolveWorkflowAgentServing } from '../lib/providers/agent_serving';
import { resolveModel } from '../lib/providers/resolve_model';
import { provisionSessionGatewayKey } from '../node_only/sandbox/gateway_provisioning';
import type { AllowedModelRef } from '../node_only/sandbox/llm_gateway_admin';

const io = vi.hoisted(() => ({
  starts: [] as Array<{ execId: string; env: Record<string, string> }>,
}));

vi.mock('../chat/external_turn_shared', async (importActual) => {
  const actual =
    await importActual<typeof import('../chat/external_turn_shared')>();
  return {
    ...actual,
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
  resolveWorkflowAgentServing: vi.fn(),
}));
vi.mock('../lib/providers/resolve_vision_model', () => ({
  resolveTurnVisionModel: async () => null,
}));
vi.mock('../node_only/sandbox/agent_session', () => ({
  ensureAgentSession: async () => ({ liveCreatedAt: 1000 }),
}));
vi.mock('../node_only/sandbox/gateway_provisioning', () => ({
  provisionSessionGatewayKey: vi.fn(async () => ({
    token: 'test-token',
    keyId: 'key-new',
    keyHash: 'hash-new',
  })),
}));
vi.mock('../node_only/sandbox/turn_equipment', () => ({
  resolveTurnEquipmentEnv: async () => ({}),
}));

const {
  automationAgentHost,
  resumeWorkflowAgentTurnWithAnswerImpl,
  startWorkflowAgentTurnImpl,
} = await import('./agent_host');

const ORG = 'org-1';
const OPENAI_RECORD = 'org-1__deepseek__deepseek-flash/deepseek-flash';
const ANTHROPIC_RECORD =
  'org-1__deepseek__deepseek-flash__anthropic/deepseek-flash';

/** The DeepSeek serving the resolver hands the host — with or without the
 * native Anthropic harness lane it computed from the connector + harness. */
function serves(anthropicHarnessLane: boolean): void {
  vi.mocked(resolveWorkflowAgentServing).mockResolvedValue({
    lane: 'gateway',
    providerSlug: 'deepseek',
    modelId: 'deepseek-flash',
    ...(anthropicHarnessLane ? { anthropicHarnessLane: true } : {}),
  });
}

const ASK = {
  _id: 'ask-1',
  runId: 'run-1',
  nodeId: 'repair_setup',
  execId: 'exec-asking',
  question: 'Which cost centre?',
  expiresAt: Date.now() + 60_000,
  status: 'answered',
  answer: 'Cost centre 4711.',
  agentSessionId: 'claude-session-1',
};

/** A run whose cursor waits on the asking exec of node `repair_setup`. */
const WAITING_CURSOR = {
  status: 'waiting',
  cursor: {
    node: 'repair_setup',
    agent: {
      execId: 'exec-asking',
      sessionId: 'wf-run-1',
      deadlineAt: Date.now() + 60_000,
      providerSlug: 'deepseek',
      gatewayModel: ANTHROPIC_RECORD,
      harness: 'claude-code',
      input: {
        model: 'deepseek-flash',
        modelProvider: 'deepseek',
        harness: 'claude-code',
        prompt: 'Repair the synthetic setup.',
      },
    },
  },
};

interface Call {
  name: string;
  args: Record<string, unknown>;
}

function makeCtx(cursor: unknown) {
  const mutations: Call[] = [];
  const scheduled: Call[] = [];
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = functionRefName(ref);
      switch (name) {
        case 'automations/queries:readAgentCursor':
          return cursor;
        case 'automations/queries:getRunLanguageContext':
          return {
            defaultLocale: 'en',
            task: { id: 'task-1', title: '2026 Q1', description: null },
          };
        case 'automations/queries:getRunProjectId':
          return null;
        case 'automations/human_asks:listAnsweredAsksForNode':
          return [];
        case 'automations/human_asks:getAskForResume':
          return ASK;
        case 'sandbox/session_queries:getSessionOpAttribution':
          return { userId: 'user-starter', agentSlug: 'vat-return-desk' };
        case 'governance/queries:getContextCapInternal':
          return null;
        default:
          throw new Error(`unexpected query ${name}`);
      }
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      mutations.push({ name, args });
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
      runAfter: async (
        _delay: number,
        ref: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push({ name: functionRefName(ref), args });
        return 'job';
      },
    },
  } as unknown as ActionCtx;
  return { ctx, mutations, scheduled };
}

const KICK = {
  runId: 'run-1',
  nodeId: 'repair_setup',
  request: {
    model: 'deepseek-flash',
    modelProvider: 'deepseek',
    harness: 'claude-code',
    prompt: 'Repair the synthetic setup.',
  },
};

const START = {
  organizationId: ORG,
  runId: 'run-1',
  nodeId: 'repair_setup',
  execId: 'exec-1',
  sessionId: 'wf-run-1',
  harness: 'claude-code',
  lane: 'gateway',
  providerSlug: 'deepseek',
  modelId: 'deepseek-flash',
  deadlineAt: Date.now() + 60_000,
  request: {
    model: 'deepseek-flash',
    modelProvider: 'deepseek',
    prompt: 'Repair the synthetic setup.',
  },
};

/** The first allowed-model ref the start's mint bound the key to. */
function mintedRef(): AllowedModelRef | undefined {
  return vi.mocked(provisionSessionGatewayKey).mock.calls[0]?.[1]
    .allowedModels[0];
}

beforeEach(() => {
  io.starts = [];
  vi.mocked(resolveModel).mockReset();
  vi.mocked(resolveWorkflowAgentServing).mockReset();
  vi.mocked(provisionSessionGatewayKey).mockClear();
  const entry: ModelCatalogEntry = {
    id: 'deepseek-flash',
    provider: 'deepseek',
    tags: ['chat', 'vision'],
    supportsTools: true,
    supportsVision: true,
    contextWindow: 1_048_576,
  };
  vi.mocked(resolveModel).mockResolvedValue({
    entry,
    connector: { name: 'deepseek' } as never,
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a Claude Code turn on a connector with a native Anthropic endpoint', () => {
  it('kicks onto the `…__anthropic` record and tells the start so', async () => {
    serves(true);
    const { ctx, mutations, scheduled } = makeCtx({ status: 'running' });

    const kicked = await automationAgentHost(ctx, ORG).kick(KICK);

    expect(kicked.gatewayModel).toBe(ANTHROPIC_RECORD);
    // The op row names the record the session will actually call.
    expect(
      mutations.find(
        (m) => m.name === 'sandbox/session_mutations:upsertSessionOp',
      )?.args.modelRef,
    ).toBe(`deepseek/${ANTHROPIC_RECORD}`);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.name).toBe(
      'automations/agent_host:startWorkflowAgentTurn',
    );
    expect(scheduled[0]?.args).toMatchObject({
      providerSlug: 'deepseek',
      modelId: 'deepseek-flash',
      gatewayModel: ANTHROPIC_RECORD,
      anthropicHarnessLane: true,
    });
  });

  it('mints the key on the `…__anthropic` record and starts the exec on it', async () => {
    const { ctx } = makeCtx({ status: 'running' });

    await startWorkflowAgentTurnImpl(ctx, {
      ...START,
      gatewayModel: ANTHROPIC_RECORD,
      anthropicHarnessLane: true,
    } as never);

    expect(console.error).not.toHaveBeenCalled();
    // The provision + mint bind the key to the SAME record the exec calls —
    // a key on the OpenAI record would 403 every request of this session.
    expect(mintedRef()).toEqual({
      providerSlug: 'deepseek',
      modelId: 'deepseek-flash',
      anthropicHarnessLane: true,
    });
    expect(io.starts).toHaveLength(1);
    expect(io.starts[0]?.env.ANTHROPIC_MODEL).toContain(ANTHROPIC_RECORD);
  });

  it('resumes after an answer on the `…__anthropic` record', async () => {
    serves(true);
    const { ctx, mutations } = makeCtx(WAITING_CURSOR);

    await resumeWorkflowAgentTurnWithAnswerImpl(ctx, {
      organizationId: ORG,
      askId: 'ask-1',
    } as never);

    expect(console.error).not.toHaveBeenCalled();
    expect(mintedRef()).toEqual({
      providerSlug: 'deepseek',
      modelId: 'deepseek-flash',
      anthropicHarnessLane: true,
    });
    expect(io.starts).toHaveLength(1);
    expect(io.starts[0]?.execId).not.toBe('exec-asking');
    expect(io.starts[0]?.env.ANTHROPIC_MODEL).toContain(ANTHROPIC_RECORD);
    // The resumed exec's op row names the same record.
    expect(
      mutations.find(
        (m) =>
          m.name === 'sandbox/session_mutations:upsertSessionOp' &&
          m.args.execId === io.starts[0]?.execId,
      )?.args.modelRef,
    ).toBe(`deepseek/${ANTHROPIC_RECORD}`);
  });
});

describe('a turn whose serving carries no Anthropic harness lane', () => {
  it('keeps the OpenAI record end to end', async () => {
    serves(false);
    const { ctx, scheduled } = makeCtx({ status: 'running' });

    const kicked = await automationAgentHost(ctx, ORG).kick(KICK);

    expect(kicked.gatewayModel).toBe(OPENAI_RECORD);
    expect(scheduled[0]?.args).toMatchObject({ gatewayModel: OPENAI_RECORD });
    expect(scheduled[0]?.args).not.toHaveProperty('anthropicHarnessLane');

    await startWorkflowAgentTurnImpl(ctx, {
      ...START,
      gatewayModel: OPENAI_RECORD,
    } as never);

    expect(mintedRef()).toEqual({
      providerSlug: 'deepseek',
      modelId: 'deepseek-flash',
    });
    expect(io.starts[0]?.env.ANTHROPIC_MODEL).toContain(OPENAI_RECORD);
  });
});
