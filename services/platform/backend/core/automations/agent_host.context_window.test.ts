// @vitest-environment node

/**
 * The serving model's context window — and the organization's Custom
 * instructions — reach every exec an automation agent node launches (the
 * kick's scheduled start and the answered-ask resume) through the REAL
 * hosts, with only external I/O replaced and the model's catalog entry
 * stubbed. Without it Claude Code assumes a 200,000-token window for a model
 * it does not know, and a turn on a local model serving 32,768 grows far past
 * what that model can prefill in time.
 */

import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { harnessResumesConversations } from '../chat/external_turn_shared';
import type { ActionCtx } from '../lib/ctx';
import { resolveModel } from '../lib/providers/resolve_model';
import {
  ROOM_PLACE_RENEW_MS,
  SessionMemoryBusyError,
  SpawnerBusyError,
} from '../node_only/sandbox/helpers/session_client';
import { resolveProviderCredential } from '../provider_credentials/resolve_credential';
import { SANDBOX_DESTROY_PENDING_MESSAGE } from '../sandbox/session_constants';
import { workflowAgentRetryResume } from './agent_retry';

const io = vi.hoisted(() => ({
  /** The serving the resolver answers; the local gateway model when unset. */
  serving: undefined as Record<string, unknown> | undefined,
  instructions: [] as string[],
  prompts: [] as string[],
  /** The org's `system_prompt` policy file; null reads as "no policy". */
  systemPrompt: null as unknown,
  /** What the session ensure throws, when it refuses. */
  sessionRefusal: undefined as Error | undefined,
  /** What the exec start throws, when the session's runtime refuses it. */
  execRefusal: undefined as Error | undefined,
  reservation: { allowed: true, budgetCents: 500 } as
    | { allowed: true; budgetCents: number }
    | { allowed: false; reason: string },
  starts: [] as Array<{
    execId: string;
    argv: string[];
    env: Record<string, string>;
  }>,
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
      io.prompts.push(args.prompt);
      return actual.buildExternalTurnExec(args);
    },
    drainHarnessWindow: async (args: {
      execId: string;
      start?: { argv: string[]; env: Record<string, string> };
    }) => {
      if (args.start !== undefined) {
        // A refused start launched nothing.
        if (io.execRefusal !== undefined) throw io.execRefusal;
        io.starts.push({
          execId: args.execId,
          argv: args.start.argv,
          env: args.start.env,
        });
      }
      return { kind: 'running', text: '', timeline: [] };
    },
  };
});
vi.mock('../lib/providers/resolve_model', () => ({
  resolveModel: vi.fn(),
}));
vi.mock(
  '../provider_credentials/resolve_credential',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../provider_credentials/resolve_credential')
    >()),
    resolveProviderCredential: vi.fn(),
  }),
);
vi.mock('../lib/providers/agent_serving', () => ({
  resolveWorkflowAgentServing: async () =>
    io.serving ?? {
      lane: 'gateway',
      providerSlug: 'local-inference',
      modelId: 'qwen3-32b',
    },
}));
vi.mock('../lib/providers/resolve_vision_model', () => ({
  resolveTurnVisionModel: async () => null,
}));
vi.mock('../node_only/sandbox/agent_session', () => ({
  ensureAgentSession: async () => {
    if (io.sessionRefusal !== undefined) throw io.sessionRefusal;
    return { liveCreatedAt: 1000 };
  },
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
  automationAgentHost,
  resumeWorkflowAgentTurnWithAnswerImpl,
  startWorkflowAgentTurnImpl,
} = await import('./agent_host');

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
  const mutations: Array<{ name: string; args: Record<string, unknown> }> = [];
  const scheduled: string[] = [];
  const delays: number[] = [];
  const scheduledArgs: unknown[] = [];
  // The run the cursor reads serve: the retarget moves its agent to the
  // resume's exec, as the shim's does, so a settle after it lands as it would.
  let served = cursor;
  const ctx = {
    runQuery: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      queries.push({ name, args });
      switch (name) {
        case 'automations/queries:readAgentCursor':
          return served;
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
        case 'governance/internal_queries:getPolicyConfigInternal':
          return args.policyType === 'system_prompt' ? io.systemPrompt : null;
        default:
          throw new Error(`unexpected query ${name}`);
      }
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      mutations.push({ name, args });
      if (name === 'sandbox/session_mutations:reserveTurnBudget') {
        return io.reservation;
      }
      if (name === 'automations/human_asks:retargetAgentCursor') {
        const run = served as { cursor: { agent: Record<string, unknown> } };
        served = {
          ...run,
          cursor: {
            ...run.cursor,
            agent: {
              ...run.cursor.agent,
              execId: args.toExecId,
              retargetedFrom: args.fromExecId,
              deadlineAt: args.deadlineAt,
            },
          },
        };
        return { retargeted: true };
      }
      return null;
    },
    runAction: async (ref: unknown) => {
      throw new Error(`unexpected action ${functionRefName(ref)}`);
    },
    scheduler: {
      runAfter: async (delay: number, ref: unknown, args: unknown) => {
        scheduled.push(functionRefName(ref));
        delays.push(delay);
        scheduledArgs.push(args);
        return 'job';
      },
    },
  } as unknown as ActionCtx;
  return { ctx, queries, scheduled, mutations, delays, scheduledArgs };
}

/** The place node `book` of run `run-1` holds in its host's line. */
const PLACE = {
  organizationId: 'org-1',
  runId: 'run-1',
  nodeId: 'book',
  sessionId: 'wf-run-1',
};

/** The renewals of a place in its host's line a host scheduled. */
function placesKept(recorded: ReturnType<typeof makeCtx>) {
  return recorded.scheduled.flatMap((name, index) =>
    name === 'automations/agent_host:keepWorkflowAgentPlace'
      ? [
          {
            delay: recorded.delays[index],
            args: recorded.scheduledArgs[index],
          },
        ]
      : [],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  io.serving = undefined;
  io.starts = [];
  io.instructions = [];
  io.prompts = [];
  io.systemPrompt = null;
  io.sessionRefusal = undefined;
  io.execRefusal = undefined;
  io.reservation = { allowed: true, budgetCents: 500 };
  vi.mocked(resolveModel).mockReset();
  vi.mocked(resolveProviderCredential).mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('an automation agent turn', () => {
  it.each(
    [
      {
        providerSlug: 'anthropic',
        harness: 'claude-code',
        modelId: 'claude-sonnet-4-6',
        apiBaseUrl: 'https://api.anthropic.com',
        targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
      },
      {
        providerSlug: 'openai',
        harness: 'codex',
        modelId: 'gpt-5.4',
        apiBaseUrl: 'https://chatgpt.com/backend-api/codex',
        targetEnvVar: 'TALE_SUBSCRIPTION_TOKEN',
      },
    ].flatMap((provider) =>
      [
        { authMethod: 'subscription-broker', endpointUrl: undefined },
        {
          authMethod: 'subscription-broker',
          endpointUrl: 'https://subscription-proxy.example.com/vendor',
        },
        { authMethod: 'subscription-key', endpointUrl: undefined },
      ].map((credential) => Object.assign({}, provider, credential)),
    ),
  )(
    'delivers the $providerSlug $authMethod channel and endpoint override $endpointUrl',
    async ({
      providerSlug,
      harness,
      modelId,
      apiBaseUrl,
      targetEnvVar,
      authMethod,
      endpointUrl,
    }) => {
      io.reservation = { allowed: true, budgetCents: 0 };
      vi.mocked(resolveProviderCredential).mockResolvedValue({
        authMethod,
        credentialId: 'credential-1',
        name: 'Synthetic broker',
        ...(authMethod === 'subscription-broker'
          ? {
              token: 'synthetic-oauth-token',
              brokerTokenHash: 'stable-selected-account-hash',
            }
          : { secret: 'synthetic-oauth-token' }),
        targetEnvVar,
        accountId: 'synthetic-account',
        ...(endpointUrl !== undefined ? { endpointUrl } : {}),
      } as never);
      const { ctx, mutations } = makeCtx({ status: 'running' });

      await startWorkflowAgentTurnImpl(ctx, {
        organizationId: 'org-1',
        runId: 'run-1',
        nodeId: 'book',
        execId: 'exec-1',
        sessionId: 'wf-run-1',
        harness,
        lane: 'subscription',
        providerSlug,
        modelId,
        gatewayModel: modelId,
        apiBaseUrl,
        deadlineAt: Date.now() + 60_000,
        request: { model: modelId, prompt: 'Book the synthetic invoice.' },
      } as never);

      expect(console.error).not.toHaveBeenCalled();
      expect(io.starts).toHaveLength(1);
      expect(io.starts[0]?.env[targetEnvVar]).toBe('synthetic-oauth-token');
      expect(resolveProviderCredential).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          requireBrokerAccountId: harness === 'codex',
        }),
      );
      if (providerSlug === 'openai') {
        expect(io.starts[0]?.env.TALE_SUBSCRIPTION_ACCOUNT_ID).toBe(
          'synthetic-account',
        );
        expect(io.starts[0]?.argv).toContain(
          `model_providers.tale-subscription.base_url="${endpointUrl ?? apiBaseUrl}"`,
        );
      } else {
        expect(io.starts[0]?.env.ANTHROPIC_BASE_URL).toBe(
          endpointUrl ?? apiBaseUrl,
        );
      }
      expect(
        mutations.find((m) => m.args.brokerTokenHash !== undefined)?.args
          .brokerTokenHash,
      ).toBe(
        authMethod === 'subscription-broker'
          ? 'stable-selected-account-hash'
          : null,
      );
      // The subscription turn holds its request — at no cost — before the
      // credential is vended (GOV-R16).
      expect(
        mutations.find(
          (m) => m.name === 'sandbox/session_mutations:reserveTurnBudget',
        )?.args,
      ).toMatchObject({
        kind: 'workflow-agent',
        defaultBudgetCents: 0,
        costFree: true,
      });
    },
  );

  it.each([
    {
      name: 'a pasted Anthropic OAuth token',
      credential: {
        secret: 'synthetic-pasted-token',
        targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
      },
      expected: {
        CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-pasted-token',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_API_KEY: '',
      },
    },
    {
      name: 'a static key that names no variable',
      credential: { secret: 'synthetic-plan-key' },
      expected: {
        ANTHROPIC_AUTH_TOKEN: 'synthetic-plan-key',
        CLAUDE_CODE_OAUTH_TOKEN: '',
      },
    },
  ])(
    'delivers $name on the channel its credential names',
    async ({ credential, expected }) => {
      vi.mocked(resolveProviderCredential).mockResolvedValue({
        authMethod: 'subscription-key',
        credentialId: 'credential-2',
        name: 'Synthetic key',
        ...credential,
      } as never);
      const { ctx } = makeCtx({ status: 'running' });

      await startWorkflowAgentTurnImpl(ctx, {
        organizationId: 'org-1',
        runId: 'run-1',
        nodeId: 'book',
        execId: 'exec-1',
        sessionId: 'wf-run-1',
        harness: 'claude-code',
        lane: 'subscription',
        providerSlug: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        gatewayModel: 'claude-sonnet-4-6',
        apiBaseUrl: 'https://api.anthropic.com',
        deadlineAt: Date.now() + 60_000,
        request: {
          model: 'claude-sonnet-4-6',
          prompt: 'Book the synthetic invoice.',
        },
      } as never);

      expect(console.error).not.toHaveBeenCalled();
      expect(io.starts).toHaveLength(1);
      expect(io.starts[0]?.env).toMatchObject(expected);
      expect(io.starts[0]?.env.ANTHROPIC_BASE_URL).toBe(
        'https://api.anthropic.com',
      );
    },
  );

  it('starts Claude Code with the serving model’s window', async () => {
    servesWindow(32_768);
    const { ctx, queries, scheduled, mutations } = makeCtx({
      status: 'running',
    });

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
    expect(
      mutations.find(
        (m) => m.name === 'automations/mutations:stampAgentTurnLaunch',
      )?.args.brokerTokenHash,
    ).toBeNull();
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

  it('settles a start the broker refused while every account cooled down with when the first is back', async () => {
    const retryAtMs = Date.now() + 42_000;
    vi.mocked(resolveProviderCredential).mockRejectedValue(
      new AppError({
        code: 'CREDENTIAL_BROKER_EXHAUSTED',
        message:
          'Every account behind credential "Synthetic broker" is cooling down after a rate limit — try again in 42 seconds.',
        retryAtMs,
      }),
    );
    const { ctx, mutations } = makeCtx({
      status: 'running',
      cursor: {
        node: 'book',
        agent: { ...WAITING_CURSOR.cursor.agent, execId: 'exec-1' },
      },
    });

    await startWorkflowAgentTurnImpl(ctx, {
      organizationId: 'org-1',
      runId: 'run-1',
      nodeId: 'book',
      execId: 'exec-1',
      sessionId: 'wf-run-1',
      harness: 'claude-code',
      lane: 'subscription',
      providerSlug: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      gatewayModel: 'claude-sonnet-4-6',
      apiBaseUrl: 'https://api.anthropic.com',
      deadlineAt: Date.now() + 60_000,
      request: {
        model: 'claude-sonnet-4-6',
        prompt: 'Book the synthetic invoice.',
      },
    } as never);

    expect(io.starts).toHaveLength(0);
    // The stepper's re-kick holds its start until then; the reason is the
    // refusal's own words, not its serialized payload.
    expect(
      mutations.find(
        (m) => m.name === 'automations/mutations:recordAgentTurnSettled',
      )?.args.result,
    ).toMatchObject({
      errored: true,
      failureCode: 'credential_cooldown',
      retryAtMs,
      reason:
        'the agent turn could not start: Every account behind credential "Synthetic broker" is cooling down after a rate limit — try again in 42 seconds.',
    });
  });

  it('settles an answered-ask resume the broker refused while every account cooled down with when the first is back', async () => {
    io.serving = {
      lane: 'subscription',
      providerSlug: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      apiBaseUrl: 'https://api.anthropic.com',
      vision: { readable: true },
    };
    servesWindow(200_000);
    const retryAtMs = Date.now() + 42_000;
    vi.mocked(resolveProviderCredential).mockRejectedValue(
      new AppError({
        code: 'CREDENTIAL_BROKER_EXHAUSTED',
        message:
          'Every account behind credential "Synthetic broker" is cooling down after a rate limit — try again in 42 seconds.',
        retryAtMs,
      }),
    );
    const { ctx, mutations } = makeCtx(WAITING_CURSOR);

    await resumeWorkflowAgentTurnWithAnswerImpl(ctx, {
      organizationId: 'org-1',
      askId: 'ask-1',
    } as never);

    expect(io.starts).toHaveLength(0);
    expect(
      mutations.find(
        (m) => m.name === 'automations/mutations:recordAgentTurnSettled',
      )?.args,
    ).toMatchObject({
      execId: 'exec-asking',
      result: {
        errored: true,
        failureCode: 'resume_failed',
        retryAtMs,
        reason:
          'the agent turn could not resume after the answer: Every account behind credential "Synthetic broker" is cooling down after a rate limit — try again in 42 seconds.',
      },
    });
  });

  it('settles an answered-ask resume refused for sandbox room with the asking conversation, the answer still undelivered', async () => {
    io.sessionRefusal = Object.assign(
      new Error('At most 2 workflow sandbox sessions can be active.'),
      { code: 'QUOTA_EXCEEDED' },
    );
    const { ctx, mutations } = makeCtx(WAITING_CURSOR);

    await resumeWorkflowAgentTurnWithAnswerImpl(ctx, {
      organizationId: 'org-1',
      askId: 'ask-1',
    } as never);

    expect(io.starts).toHaveLength(0);
    expect(
      mutations.find(
        (m) => m.name === 'automations/mutations:recordAgentTurnSettled',
      )?.args,
    ).toMatchObject({
      execId: 'exec-asking',
      result: {
        errored: true,
        failureCode: 'sandbox_capacity',
        agentSessionId: 'claude-session-1',
        undeliveredAskId: 'ask-1',
        retryAfterMs: 15_000,
      },
    });
  });

  it('keeps the asking conversation for the re-kick when the session refuses the resumed exec for want of memory', async () => {
    // Refused after the cursor moved to the resume's exec (#4719): nothing
    // launched, so the settle still names the asking conversation and the
    // answer it never brought, or the re-kick starts the node over — or
    // resumes the conversation an earlier retry did, which the retarget kept.
    servesWindow(65_536);
    io.execRefusal = new SessionMemoryBusyError(
      'wf-run-1',
      'exec-resume',
      5_000,
      'the session is using 90% or more of its memory limit',
    );
    const parked = {
      ...WAITING_CURSOR.cursor.agent,
      resumedFrom: 'claude-session-0',
      resumeReason: 'the stream broke',
    };
    const { ctx, mutations } = makeCtx({
      ...WAITING_CURSOR,
      cursor: { ...WAITING_CURSOR.cursor, agent: parked },
    });

    await resumeWorkflowAgentTurnWithAnswerImpl(ctx, {
      organizationId: 'org-1',
      askId: 'ask-1',
    } as never);

    expect(io.starts).toHaveLength(0);
    const retarget = mutations.find(
      (m) => m.name === 'automations/human_asks:retargetAgentCursor',
    )?.args;
    expect(retarget?.fromExecId).toBe('exec-asking');
    const settled = mutations.find(
      (m) => m.name === 'automations/mutations:recordAgentTurnSettled',
    )?.args;
    expect(settled).toMatchObject({
      execId: retarget?.toExecId,
      result: {
        errored: true,
        failureCode: 'sandbox_capacity',
        agentSessionId: 'claude-session-1',
        undeliveredAskId: 'ask-1',
        retryAfterMs: 15_000,
      },
    });

    // The stepper's re-kick of that settle delivers the answer to the
    // asking conversation.
    const result = settled?.result as Parameters<
      typeof workflowAgentRetryResume
    >[0] & { reason: string };
    const resume = workflowAgentRetryResume(result, result.reason, parked, {
      resumable: harnessResumesConversations(parked.harness),
    });
    expect(resume).toEqual({
      agentSessionId: 'claude-session-1',
      reason: result.reason,
      askId: 'ask-1',
    });
    io.execRefusal = undefined;
    vi.mocked(console.error).mockClear();
    await startWorkflowAgentTurnImpl(makeCtx({ status: 'running' }).ctx, {
      organizationId: 'org-1',
      runId: 'run-1',
      nodeId: 'book',
      execId: 'exec-2',
      sessionId: 'wf-run-1',
      harness: 'claude-code',
      lane: 'gateway',
      providerSlug: 'local-inference',
      modelId: 'qwen3-32b',
      gatewayModel: 'local-inference-org-1/qwen3-32b',
      deadlineAt: Date.now() + 60_000,
      request: { model: 'qwen3-32b', prompt: 'Book the synthetic invoice.' },
      resume,
    } as never);

    expect(console.error).not.toHaveBeenCalled();
    expect(io.starts).toHaveLength(1);
    expect(io.starts[0]?.argv).toContain('claude-session-1');
    const prompt = io.prompts.at(-1);
    expect(prompt).toContain('The operator answered your question:');
    expect(prompt).toContain('Cost centre 4711.');
    expect(prompt).not.toContain('cut short by an infrastructure');
  });

  it.each([
    {
      refusal: 'a place in its host’s line',
      error: () => new SpawnerBusyError(5_000, { position: 0, waiting: 1 }),
      kept: [{ delay: ROOM_PLACE_RENEW_MS, args: PLACE }],
    },
    {
      refusal: 'no place',
      error: () => new SpawnerBusyError(15_000),
      kept: [],
    },
  ])(
    'keeps the place of a start refused for sandbox room with $refusal until its re-kick asks again',
    async ({ error, kept }) => {
      // The re-kick's start waits for a start slot, which under load takes
      // longer than the spawner keeps a waiter it does not hear from.
      io.sessionRefusal = error();
      const recorded = makeCtx({
        status: 'running',
        cursor: {
          node: 'book',
          agent: { ...WAITING_CURSOR.cursor.agent, execId: 'exec-1' },
        },
      });

      await startWorkflowAgentTurnImpl(recorded.ctx, {
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

      expect(io.starts).toHaveLength(0);
      expect(
        recorded.mutations.find(
          (m) => m.name === 'automations/mutations:recordAgentTurnSettled',
        )?.args.result,
      ).toMatchObject({
        errored: true,
        failureCode: 'sandbox_capacity',
        ...(kept.length > 0 ? { roomQueued: true } : {}),
      });
      expect(placesKept(recorded)).toEqual(kept);
    },
  );

  it('keeps the place of an answered-ask resume refused for sandbox room with a place in its host’s line', async () => {
    io.sessionRefusal = new SpawnerBusyError(5_000, {
      position: 0,
      waiting: 1,
    });
    const recorded = makeCtx(WAITING_CURSOR);

    await resumeWorkflowAgentTurnWithAnswerImpl(recorded.ctx, {
      organizationId: 'org-1',
      askId: 'ask-1',
    } as never);

    expect(io.starts).toHaveLength(0);
    expect(
      recorded.mutations.find(
        (m) => m.name === 'automations/mutations:recordAgentTurnSettled',
      )?.args.result,
    ).toMatchObject({
      failureCode: 'sandbox_capacity',
      roomQueued: true,
      undeliveredAskId: 'ask-1',
    });
    expect(placesKept(recorded)).toEqual([
      { delay: ROOM_PLACE_RENEW_MS, args: PLACE },
    ]);
  });

  it('fails a start whose workspace an administrator is destroying with the reason, waiting for no room', async () => {
    // What the shim throws for a session whose Destroy is pending (#4122).
    io.sessionRefusal = new AppError({
      code: 'QUOTA_EXCEEDED',
      message: SANDBOX_DESTROY_PENDING_MESSAGE,
      reason: 'destroy_pending',
    });
    const { ctx, mutations } = makeCtx({
      status: 'running',
      cursor: {
        node: 'book',
        agent: { ...WAITING_CURSOR.cursor.agent, execId: 'exec-1' },
      },
    });

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

    expect(io.starts).toHaveLength(0);
    const settled = mutations.find(
      (m) => m.name === 'automations/mutations:recordAgentTurnSettled',
    )?.args.result;
    expect(settled).toMatchObject({
      errored: true,
      failureCode: 'sandbox_destroying',
      reason: `the agent turn could not start: ${SANDBOX_DESTROY_PENDING_MESSAGE}`,
    });
    expect(settled).not.toHaveProperty('retryAtMs');
    expect(settled).not.toHaveProperty('retryAfterMs');
    // A refused start, not a wait for room: the op row reads failed.
    expect(
      mutations.some((m) => m.args.agentResultStatus === 'awaiting_room'),
    ).toBe(false);
  });

  it('fails an answered-ask resume whose workspace an administrator is destroying, leaving no answer to deliver', async () => {
    io.sessionRefusal = new AppError({
      code: 'QUOTA_EXCEEDED',
      message: SANDBOX_DESTROY_PENDING_MESSAGE,
      reason: 'destroy_pending',
    });
    const { ctx, mutations } = makeCtx(WAITING_CURSOR);

    await resumeWorkflowAgentTurnWithAnswerImpl(ctx, {
      organizationId: 'org-1',
      askId: 'ask-1',
    } as never);

    expect(io.starts).toHaveLength(0);
    const settled = mutations.find(
      (m) => m.name === 'automations/mutations:recordAgentTurnSettled',
    )?.args;
    expect(settled).toMatchObject({
      execId: 'exec-asking',
      result: {
        errored: true,
        failureCode: 'sandbox_destroying',
        reason: `the agent turn could not resume after the answer: ${SANDBOX_DESTROY_PENDING_MESSAGE}`,
      },
    });
    expect(settled?.result).not.toHaveProperty('undeliveredAskId');
    expect(settled?.result).not.toHaveProperty('retryAfterMs');
  });

  it('resumes the asking conversation with an answer its refused delivery never brought', async () => {
    servesWindow(65_536);
    const { ctx } = makeCtx({ status: 'running' });

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
      resume: {
        agentSessionId: 'claude-session-1',
        reason:
          "the agent turn is waiting for sandbox room: the organization's workflow sessions are all in use",
        askId: 'ask-1',
      },
    } as never);

    expect(console.error).not.toHaveBeenCalled();
    expect(io.starts).toHaveLength(1);
    expect(io.starts[0]?.argv).toContain('claude-session-1');
    expect(io.prompts[0]).toContain('The operator answered your question:');
    expect(io.prompts[0]).toContain('Cost centre 4711.');
    expect(io.prompts[0]).not.toContain('cut short by an infrastructure');
  });

  it('holds a kicked start until a cooling broker pool has an account back', async () => {
    const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    try {
      const { ctx, delays } = makeCtx({ status: 'running' });
      const host = automationAgentHost(ctx, 'org-1');
      const kick = {
        runId: 'run-1',
        nodeId: 'book',
        request: { model: 'qwen3-32b', prompt: 'Book the synthetic invoice.' },
      };

      const now = await host.kick(kick);
      const held = await host.kick({ ...kick, notBefore: NOW + 42_000 });
      await host.kick({ ...kick, notBefore: NOW + 100_000 });
      await host.kick({ ...kick, notBefore: NOW + 10 * 60_000 });
      await host.kick({ ...kick, notBefore: NOW - 1 });

      // A wait for sandbox room holds its start up to two minutes; never
      // longer, nor for a hold already over.
      expect(delays).toEqual([0, 42_000, 100_000, 120_000, 0]);
      // The turn's time limit counts from its start, not from the kick.
      expect(held.deadlineAt - now.deadlineAt).toBe(42_000);
    } finally {
      vi.useRealTimers();
    }
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

describe("the organization's Custom instructions", () => {
  const HOUSE_RULE = 'Sign every report as the Finance desk.';

  it('lead the instructions of an agent node start and of its resume', async () => {
    servesWindow(32_768);
    io.systemPrompt = { enabled: true, mandatoryInstructions: HOUSE_RULE };
    const start = makeCtx({ status: 'running' });
    await startWorkflowAgentTurnImpl(start.ctx, {
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
      request: {
        model: 'qwen3-32b',
        prompt: 'Book the synthetic invoice.',
        system: 'You are the invoice desk.',
      },
    } as never);

    const resume = makeCtx(WAITING_CURSOR);
    await resumeWorkflowAgentTurnWithAnswerImpl(resume.ctx, {
      organizationId: 'org-1',
      askId: 'ask-1',
    } as never);

    expect(io.instructions).toHaveLength(2);
    expect(
      io.instructions[0]?.startsWith(
        `${HOUSE_RULE}\n\nYou are the invoice desk.`,
      ),
    ).toBe(true);
    expect(io.instructions[1]?.startsWith(HOUSE_RULE)).toBe(true);
    for (const instructions of io.instructions) {
      expect(instructions.split(HOUSE_RULE)).toHaveLength(2);
    }
    // Every policy the start reads (the Custom instructions, the image
    // generation switch) is the run's own organization's, never another's.
    const policyReads = start.queries.filter(
      (q) => q.name === 'governance/internal_queries:getPolicyConfigInternal',
    );
    expect(policyReads.map((q) => q.args)).toContainEqual({
      organizationId: 'org-1',
      policyType: 'system_prompt',
    });
    for (const read of policyReads) {
      expect(read.args).toMatchObject({ organizationId: 'org-1' });
    }
    expect(console.error).not.toHaveBeenCalled();
  });

  it('add nothing when the organization has no Custom instructions', async () => {
    servesWindow(32_768);
    const { ctx } = makeCtx({ status: 'running' });
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
      request: {
        model: 'qwen3-32b',
        prompt: 'Book the synthetic invoice.',
        system: 'You are the invoice desk.',
      },
    } as never);

    expect(io.instructions[0]?.startsWith('You are the invoice desk.')).toBe(
      true,
    );
  });
});
