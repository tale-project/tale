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

import { AppError } from '../../../lib/shared/errors/app-error';
import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { resolveModel } from '../lib/providers/resolve_model';
import { resolveProviderCredential } from '../provider_credentials/resolve_credential';

const io = vi.hoisted(() => ({
  instructions: [] as string[],
  starts: [] as Array<{
    execId: string;
    argv: string[];
    env: Record<string, string>;
  }>,
  builds: [] as Array<{ execId: string; contextWindow?: number }>,
  /** The windows the drain answers, in order; `running` once they run out. */
  windows: [] as unknown[],
  subscription: undefined as
    | undefined
    | { providerSlug: string; modelId: string; apiBaseUrl: string },
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
      start?: { argv: string[]; env: Record<string, string> };
    }) => {
      if (args.start !== undefined) {
        io.starts.push({
          execId: args.execId,
          argv: args.start.argv,
          env: args.start.env,
        });
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
  resolveTaskServing: async () =>
    io.subscription === undefined
      ? {
          lane: 'gateway',
          providerSlug: 'local-inference',
          modelId: 'qwen3-32b',
        }
      : {
          lane: 'subscription',
          ...io.subscription,
          vision: { readable: true },
        },
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
  const mutations: Array<{ name: string; args: Record<string, unknown> }> = [];
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
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      mutations.push({ name, args });
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
  return { ctx: ctx as never, queries, mutations };
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
  vi.clearAllMocks();
  io.starts = [];
  io.instructions = [];
  io.builds = [];
  io.windows = [];
  io.subscription = undefined;
  vi.mocked(resolveProviderCredential).mockReset();
  vi.mocked(resolveModel).mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a task agent start', () => {
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
      [undefined, 'https://subscription-proxy.example.com/vendor'].map(
        (endpointUrl) => Object.assign({}, provider, { endpointUrl }),
      ),
    ),
  )(
    'delivers the $providerSlug broker channel and endpoint override $endpointUrl',
    async ({
      providerSlug,
      harness,
      modelId,
      apiBaseUrl,
      targetEnvVar,
      endpointUrl,
    }) => {
      io.subscription = { providerSlug, modelId, apiBaseUrl };
      vi.mocked(resolveProviderCredential).mockResolvedValue({
        authMethod: 'subscription-broker',
        credentialId: 'credential-1',
        name: 'Synthetic broker',
        token: 'synthetic-oauth-token',
        targetEnvVar,
        accountId: 'synthetic-account',
        brokerTokenHash: 'stable-selected-account-hash',
        ...(endpointUrl !== undefined ? { endpointUrl } : {}),
      } as never);
      const { ctx, mutations } = makeCtx({
        status: 'queued',
        execId: 'exec-1',
      });

      await startTaskAgentTurnImpl(ctx, {
        ...KEYS,
        harness,
        model: modelId,
        modelProvider: providerSlug,
        sweep: true,
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
      ).toBe('stable-selected-account-hash');
    },
  );

  it('fails a start the broker refused while every account cooled down, naming when the first is back', async () => {
    io.subscription = {
      providerSlug: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      apiBaseUrl: 'https://api.anthropic.com',
    };
    const retryAtMs = Date.now() + 42_000;
    vi.mocked(resolveProviderCredential).mockRejectedValue(
      new AppError({
        code: 'CREDENTIAL_BROKER_EXHAUSTED',
        message:
          'Every account behind credential "Synthetic broker" is cooling down after a rate limit — try again in 42 seconds.',
        retryAtMs,
      }),
    );
    const { ctx, mutations } = makeCtx({ status: 'queued', execId: 'exec-1' });

    await startTaskAgentTurnImpl(ctx, {
      ...KEYS,
      model: 'claude-sonnet-4-6',
      modelProvider: 'anthropic',
      sweep: true,
    } as never);

    expect(io.starts).toHaveLength(0);
    // The retry this arms waits for the cooldown instead of meeting the same
    // refusal at once; the run shows the refusal's words, not its payload.
    expect(
      mutations.find(
        (m) => m.name === 'tasks/agent_runs:markTaskAgentRunFailed',
      )?.args,
    ).toMatchObject({
      runId: 'run-1',
      execId: 'exec-1',
      failureCode: 'credential_cooldown',
      retryAtMs,
      error:
        'the agent run could not start: Every account behind credential "Synthetic broker" is cooling down after a rate limit — try again in 42 seconds.',
    });
  });

  it('hands Claude Code the serving model’s window', async () => {
    servesWindow(32_768);
    const { ctx, queries, mutations } = makeCtx({
      status: 'queued',
      execId: 'exec-1',
    });

    await startTaskAgentTurnImpl(ctx, { ...KEYS, sweep: true } as never);

    expect(io.starts).toHaveLength(1);
    expect(
      mutations.find(
        (m) => m.name === 'tasks/agent_runs:stampTaskAgentRunBrokerToken',
      )?.args.brokerTokenHash,
    ).toBeNull();
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

  it('fails a restart the broker refused while every account cooled down, naming when the first is back', async () => {
    io.subscription = {
      providerSlug: 'openai',
      modelId: 'gpt-5.4',
      apiBaseUrl: 'https://chatgpt.com/backend-api/codex',
    };
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
      execId: 'exec-1',
    });

    await steerTaskAgentTurnImpl(ctx, {
      ...KEYS,
      harness: 'codex',
      model: 'gpt-5.4',
      modelProvider: 'openai',
      feedback: 'Use the second address.',
      author: 'Dana',
      authorId: 'user-dana',
      attempt: 0,
    } as never);

    expect(io.starts).toHaveLength(0);
    expect(
      mutations.find(
        (m) => m.name === 'tasks/agent_runs:markTaskAgentRunFailed',
      )?.args,
    ).toMatchObject({
      execId: 'exec-rotated',
      failureCode: 'steer_restart_failed',
      retryAtMs,
      error:
        'the run could not be restarted to take a new comment: Every account behind credential "Synthetic broker" is cooling down after a rate limit — try again in 42 seconds.',
    });
  });
});
