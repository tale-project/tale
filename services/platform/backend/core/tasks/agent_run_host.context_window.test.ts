/**
 * The serving model's context window — and the organization's Custom
 * instructions — reach every exec a task agent run launches: the REAL start
 * and steer hosts, with only external I/O replaced and the model's catalog
 * entry stubbed. Without it Claude Code assumes a
 * 200,000-token window for a model it does not know — a local model serving
 * 32,768 let a desk turn grow to ~140K before the CLI compacted, and the
 * prefill outlasted the CLI's own 30-minute stream watchdog.
 */

import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { safeFetch } from '../../../lib/net/safe-fetch';
import { AppError } from '../../../lib/shared/errors/app-error';
import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import {
  classifyOutcome,
  NO_OUTCOME_RESULT_STATUSES,
} from '../../domains/sandbox/external-turn-outcome';
import { releaseTurnKey } from '../automations/agent_host';
import { resolveModel } from '../lib/providers/resolve_model';
import { encryptSecret } from '../lib/secret_box';
import { resolveProviderCredential } from '../provider_credentials/resolve_credential';
import {
  AWAITING_ROOM_RESULT_STATUS,
  SANDBOX_DESTROY_PENDING_MESSAGE,
} from '../sandbox/session_constants';

const io = vi.hoisted(() => ({
  instructions: [] as string[],
  /** The org's `system_prompt` policy file; null reads as "no policy". */
  systemPrompt: null as unknown,
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
  /** What the session ensure throws, when it refuses. */
  sessionRefusal: undefined as Error | undefined,
  brokerRow: null as unknown,
  ensures: 0,
}));

vi.mock('../../../lib/net/safe-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/net/safe-fetch')>()),
  safeFetch: vi.fn(),
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
  releaseTurnKey: vi.fn(async () => ({ won: true })),
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
  ensureAgentSession: async () => {
    io.ensures++;
    if (io.sessionRefusal !== undefined) throw io.sessionRefusal;
    return { liveCreatedAt: 1000 };
  },
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
  confined?: boolean;
  rotateAfterSelection?: boolean;
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
      if (name === 'provider_credentials/queries:getDefaultCredentialInternal')
        return io.brokerRow;
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
      if (name === 'governance/internal_queries:getPolicyConfigInternal') {
        return args.policyType === 'system_prompt' ? io.systemPrompt : null;
      }
      // An editor's run: the agent's full equipment.
      if (name === 'tasks/agent_runs:getTaskAgentRunAuthority') {
        if (
          run.rotateAfterSelection &&
          mutations.some(
            ({ name: mutationName }) =>
              mutationName ===
              'provider_credentials/mutations:selectBrokerAccountInternal',
          )
        ) {
          run.execId = 'successor-exec';
        }
        return { confined: run.confined ?? false };
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
      if (
        name === 'provider_credentials/mutations:selectBrokerAccountInternal'
      ) {
        const candidates = args.candidates as { hash: string }[];
        return { hash: candidates[0]?.hash ?? null, fellBack: false };
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
  io.systemPrompt = null;
  io.builds = [];
  io.windows = [];
  io.subscription = undefined;
  io.sessionRefusal = undefined;
  io.brokerRow = null;
  io.ensures = 0;
  vi.mocked(resolveProviderCredential).mockReset();
  vi.mocked(resolveModel).mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a task agent start', () => {
  it.each([
    'recover',
    'cancel',
    'rotate',
    'rotate-during-final-authority',
    'confine',
    'job-abort',
    'initially-confined',
  ] as const)(
    'keeps real broker recovery inside one admitted task: %s',
    async (mode) => {
      vi.useFakeTimers({
        toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'],
      });
      vi.spyOn(Math, 'random').mockReturnValue(0);
      vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
      try {
        const actual = await vi.importActual<
          typeof import('../provider_credentials/resolve_credential')
        >('../provider_credentials/resolve_credential');
        vi.mocked(resolveProviderCredential).mockImplementation(
          actual.resolveProviderCredential,
        );
        io.subscription = {
          providerSlug: 'anthropic',
          modelId: 'claude-sonnet',
          apiBaseUrl: 'https://api.anthropic.com',
        };
        io.brokerRow = {
          _id: 'credential-1',
          organizationId: 'org-1',
          providerSlug: 'anthropic',
          authMethod: 'subscription-broker',
          status: 'active',
          name: 'Synthetic broker',
          encryptedData: encryptSecret(
            JSON.stringify({
              endpoint: 'https://broker.example/pool',
              httpMethod: 'GET',
              auth: { method: 'none' },
              responseMapping: {
                tokensPath: '$.tokens',
                tokenField: 'access_token',
              },
              targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
              selection: 'first',
            }),
          ),
        };
        const response = {
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          finalUrl: 'https://broker.example/pool',
          body: JSON.stringify({
            tokens: [{ access_token: 'synthetic-token' }],
          }),
        };
        vi.mocked(safeFetch)
          .mockReset()
          .mockResolvedValueOnce({ ...response, status: 521 })
          .mockResolvedValue(response);
        const run = {
          status: 'queued',
          execId: 'exec-1',
          confined: mode === 'initially-confined',
          rotateAfterSelection: mode === 'rotate-during-final-authority',
        };
        const { ctx, mutations } = makeCtx(run);
        const controller = new AbortController();
        const promise = startTaskAgentTurnImpl(
          ctx,
          {
            ...KEYS,
            modelProvider: 'anthropic',
            model: 'claude-sonnet',
            deadlineAt: Date.now() + 60_000,
          } as never,
          { signal: controller.signal },
        );
        await vi.advanceTimersByTimeAsync(1);
        expect(safeFetch).toHaveBeenCalledTimes(1);
        expect(io.starts).toHaveLength(0);
        if (mode === 'cancel') run.status = 'cancelled';
        if (mode === 'rotate') run.execId = 'successor-exec';
        if (mode === 'confine') run.confined = true;
        if (mode === 'job-abort') controller.abort();
        await vi.advanceTimersByTimeAsync(4_999);
        await promise;
        expect(io.ensures).toBe(1);
        const selected =
          mode === 'recover' || mode === 'rotate-during-final-authority';
        expect(safeFetch).toHaveBeenCalledTimes(selected ? 2 : 1);
        expect(io.starts).toHaveLength(mode === 'recover' ? 1 : 0);
        expect(
          mutations.filter(
            ({ name }) => name === 'tasks/agent_runs:setTaskAgentRunRunning',
          ),
        ).toHaveLength(mode === 'recover' ? 1 : 0);
        expect(
          mutations.filter(
            ({ name }) =>
              name ===
              'provider_credentials/mutations:selectBrokerAccountInternal',
          ),
        ).toHaveLength(selected ? 1 : 0);
        if (mode === 'recover') {
          expect(io.starts[0]?.execId).toBe('exec-1');
          expect(console.error).not.toHaveBeenCalled();
        }
        if (mode === 'initially-confined')
          expect(
            vi.mocked(resolveProviderCredential).mock.calls[0]?.[2],
          ).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
        vi.mocked(Math.random).mockRestore();
        vi.unstubAllEnvs();
      }
    },
  );
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
        expect.objectContaining({
          deadlineAt: KEYS.deadlineAt,
          assertCurrent: expect.any(Function),
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
      io.subscription = {
        providerSlug: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        apiBaseUrl: 'https://api.anthropic.com',
      };
      vi.mocked(resolveProviderCredential).mockResolvedValue({
        authMethod: 'subscription-key',
        credentialId: 'credential-2',
        name: 'Synthetic key',
        ...credential,
      } as never);
      const { ctx } = makeCtx({ status: 'queued', execId: 'exec-1' });

      await startTaskAgentTurnImpl(ctx, {
        ...KEYS,
        harness: 'claude-code',
        model: 'claude-sonnet-4-6',
        modelProvider: 'anthropic',
        sweep: true,
      } as never);

      expect(console.error).not.toHaveBeenCalled();
      expect(io.starts).toHaveLength(1);
      expect(io.starts[0]?.env).toMatchObject(expected);
      expect(io.starts[0]?.env.ANTHROPIC_BASE_URL).toBe(
        'https://api.anthropic.com',
      );
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

  it('parks a start whose workspace an administrator is destroying until the Destroy settles', async () => {
    // What the shim throws for a session whose Destroy is pending: no want
    // of room, but the task lane waits on it all the same (#4122).
    io.sessionRefusal = new AppError({
      code: 'QUOTA_EXCEEDED',
      message: SANDBOX_DESTROY_PENDING_MESSAGE,
      reason: 'destroy_pending',
    });
    const { ctx, mutations } = makeCtx({ status: 'queued', execId: 'exec-1' });

    await startTaskAgentTurnImpl(ctx, { ...KEYS, sweep: true } as never);

    expect(io.starts).toHaveLength(0);
    expect(
      mutations.find(
        (m) => m.name === 'tasks/agent_runs:parkTaskAgentRunForCapacity',
      )?.args,
    ).toEqual({ runId: 'run-1', execId: 'exec-1' });
    expect(
      mutations.some(
        (m) => m.name === 'tasks/agent_runs:markTaskAgentRunFailed',
      ),
    ).toBe(false);
  });

  /** The start window of an exec the workspace's runtime refused before it
   * spawned: the spawner's result for runnerd's `fail` (no exit, no output). */
  function refusedExecWindow(errorCode: string, errorMessage: string) {
    return {
      kind: 'terminal',
      text: '',
      textTruncated: false,
      answerText: '',
      timeline: [],
      exited: true,
      execResult: {
        status: 'failed',
        exitCode: null,
        durationMs: 0,
        stdoutBase64: '',
        stderrBase64: '',
        truncated: { stdout: false, stderr: false },
        errorCode,
        errorMessage,
      },
      outputTokens: 0,
    };
  }

  it('parks a launched start whose exec found every live-exec place of its workspace taken, instead of failing it', async () => {
    // The agent's other runs hold all of the workspace's exec places: the
    // runtime refuses the fifth exec before it spawns (`EXEC_LIMIT`).
    io.windows = [refusedExecWindow('EXEC_LIMIT', 'live exec cap 4 reached')];
    const { ctx, mutations } = makeCtx({ status: 'queued', execId: 'exec-1' });

    await startTaskAgentTurnImpl(ctx, { ...KEYS, sweep: true } as never);

    expect(io.starts).toHaveLength(1);
    // Parked through the capacity lane, off its launch: no failure, no
    // settle, so no retry is armed and no attempt is spent.
    expect(
      mutations.find(
        (m) => m.name === 'tasks/agent_runs:parkTaskAgentRunForCapacity',
      )?.args,
    ).toEqual({ runId: 'run-1', execId: 'exec-1', execRefused: true });
    expect(
      mutations.some(
        (m) =>
          m.name === 'tasks/agent_runs:markTaskAgentRunFailed' ||
          m.name === 'tasks/agent_runs:markTaskAgentRunSettled' ||
          m.name === 'tasks/agent_runs:completeTaskAgentRun',
      ),
    ).toBe(false);
    // The refused exec's key and op row close as cancelled, marked as a
    // room wait: nothing ran.
    expect(releaseTurnKey).toHaveBeenCalledExactlyOnceWith(ctx, {
      organizationId: 'org-1',
      sessionId: 'pa-alice',
      execId: 'exec-1',
      status: 'cancelled',
      agentResultStatus: AWAITING_ROOM_RESULT_STATUS,
    });
  });

  it('closes a refused exec as a room wait, never as a cancelled turn of the external-turn metrics', async () => {
    io.windows = [refusedExecWindow('EXEC_LIMIT', 'live exec cap 4 reached')];
    const { ctx } = makeCtx({ status: 'queued', execId: 'exec-1' });

    await startTaskAgentTurnImpl(ctx, { ...KEYS, sweep: true } as never);

    // The op row as the start finalizes it, read the way the metrics read
    // it: no outcome, left out before the row cap. Counted as a cancelled
    // turn, every refusal — and every re-wake into a still-full workspace —
    // would add one, with a near-zero duration.
    const closed = vi.mocked(releaseTurnKey).mock.calls[0]?.[1];
    expect(closed?.status).toBe('cancelled');
    expect(NO_OUTCOME_RESULT_STATUSES).toContain(closed?.agentResultStatus);
    expect(
      classifyOutcome(closed?.agentResultStatus ?? null, closed?.status ?? ''),
    ).toBe('parked');
  });

  it('still fails a start whose exec the runtime refused for any other reason', async () => {
    io.windows = [refusedExecWindow('RUNTIME_ERROR', 'exec id is live')];
    const { ctx, mutations } = makeCtx({ status: 'queued', execId: 'exec-1' });

    await startTaskAgentTurnImpl(ctx, { ...KEYS, sweep: true } as never);

    expect(
      mutations.find(
        (m) => m.name === 'tasks/agent_runs:markTaskAgentRunFailed',
      )?.args,
    ).toMatchObject({
      runId: 'run-1',
      execId: 'exec-1',
      failureCode: 'harness_error',
    });
    expect(
      mutations.some(
        (m) => m.name === 'tasks/agent_runs:parkTaskAgentRunForCapacity',
      ),
    ).toBe(false);
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

describe("the organization's Custom instructions", () => {
  const HOUSE_RULE = 'Sign every report as the Finance desk.';

  it('lead the instructions of a start and of a steer restart', async () => {
    servesWindow(32_768);
    io.systemPrompt = { enabled: true, mandatoryInstructions: HOUSE_RULE };
    const start = makeCtx({ status: 'queued', execId: 'exec-1' });
    await startTaskAgentTurnImpl(start.ctx, {
      ...KEYS,
      instructions: 'You are the invoice desk.',
      sweep: true,
    } as never);

    const steer = makeCtx({ status: 'running', execId: 'exec-1' });
    await steerTaskAgentTurnImpl(steer.ctx, {
      ...KEYS,
      harness: 'codex',
      instructions: 'You are the invoice desk.',
      feedback: 'Use the second address.',
      author: 'Dana',
      authorId: 'user-dana',
      attempt: 0,
    } as never);

    expect(io.instructions).toHaveLength(2);
    for (const instructions of io.instructions) {
      expect(
        instructions.startsWith(`${HOUSE_RULE}\n\nYou are the invoice desk.`),
      ).toBe(true);
      expect(instructions.split(HOUSE_RULE)).toHaveLength(2);
    }
    // Read for the run's own organization, never another's.
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

  it('add nothing when the section is switched off', async () => {
    servesWindow(32_768);
    io.systemPrompt = { enabled: false, mandatoryInstructions: HOUSE_RULE };
    const { ctx } = makeCtx({ status: 'queued', execId: 'exec-1' });
    await startTaskAgentTurnImpl(ctx, {
      ...KEYS,
      instructions: 'You are the invoice desk.',
      sweep: true,
    } as never);

    expect(io.instructions[0]).not.toContain(HOUSE_RULE);
    expect(io.instructions[0]?.startsWith('You are the invoice desk.')).toBe(
      true,
    );
  });
});
