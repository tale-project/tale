/**
 * A brokered task agent turn whose token the broker rotated under it — the
 * REAL drive host, drain, parser and end classification, with only external
 * I/O replaced.
 *
 * Observed live (2026-09-28): the AI gateway refreshed every Anthropic
 * account at 11:00:58, Anthropic revoked the tokens those refreshes
 * replaced, and a Claude Code run two minutes into its turn died on "401
 * OAuth access token has been revoked". It settled `harness_error`: the
 * retry spent one of the three crash-loop attempts and excluded an account
 * that already held a fresh token. A 401 on a brokered turn is the broker's
 * rotation, named as such, so the retry vends again and resumes for free.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { isAutoRetryableFailure } from './task_auto_retry';

const io = vi.hoisted(() => ({
  stdout: '',
  checkpoint: null as { seq: number; state: unknown } | null,
  resumedAt: [] as number[],
  beforeStdout: undefined as (() => void) | undefined,
}));

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
    // The window closes a Claude turn's held stdin; no spawner answers here.
    sessionWriteExecStdin: async () => ({ ok: true }),
    sessionGetExecCheckpoint: async () => io.checkpoint,
    sessionPutExecCheckpoint: async (
      _sessionId: string,
      _execId: string,
      checkpoint: { seq: number; state: unknown },
    ) => {
      io.checkpoint = JSON.parse(JSON.stringify(checkpoint));
    },
    drainSessionExecResilient: async (
      _sessionId: string,
      _body: unknown,
      _signal: AbortSignal,
      callbacks: { onStdout?: (chunk: string) => void },
      options: { cursor: { lastSeq: number }; resumeSinceSeq?: number },
    ) => {
      if (options.resumeSinceSeq !== undefined)
        io.resumedAt.push(options.resumeSinceSeq);
      if (io.stdout !== '') options.cursor.lastSeq++;
      io.beforeStdout?.();
      callbacks.onStdout?.(io.stdout);
      return {
        status: 'completed',
        exitCode: 0,
        durationMs: 1,
        stdoutBase64: '',
        stderrBase64: '',
        truncated: { stdout: false, stderr: false },
      };
    },
    sessionCancelExec: async () => true,
    sessionExecStatus: async () => ({ state: 'exited', exitCode: 0 }),
  };
});

const { driveTaskAgentTurnImpl } = await import('./agent_run_host');
const { drainHarnessWindow } = await import('../chat/external_turn_shared');

interface RunState {
  status: string;
  execId: string;
  brokerTokenHash?: string;
}

interface Call {
  name: string;
  args: Record<string, unknown>;
}

function makeCtx(run: RunState) {
  const mutations: Call[] = [];
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = functionRefName(ref);
      if (name === 'tasks/agent_runs:getTaskAgentRunForDrive') return run;
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      mutations.push({ name, args });
      if (name === 'tasks/agent_runs:markTaskAgentRunFailed') {
        run.status = 'failed';
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
  return { ctx: ctx as never, mutations };
}

const failedMarks = (mutations: Call[]) =>
  mutations.filter((m) => m.name === 'tasks/agent_runs:markTaskAgentRunFailed');

const KEYS = {
  organizationId: 'org-1',
  runId: 'run-1',
  taskId: 'task-1',
  agentId: 'alice',
  execId: 'exec-1',
  sessionId: 'pa-alice',
  harness: 'claude-code',
  deadlineAt: Date.now() + 60 * 60_000,
};

/** One stream-json line per event. */
function ndjson(lines: Array<Record<string, unknown>>): string {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

/** What the pinned Claude Code CLI printed for the incident's turn. */
const REVOKED =
  'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth access token has been revoked. Please obtain a new token or refresh your existing token."}}';

const CLAUDE_REVOKED = ndjson([
  { type: 'system', subtype: 'init', session_id: 'conv-401' },
  {
    type: 'assistant',
    message: {
      id: 'msg_1',
      content: [{ type: 'text', text: 'Reading the retry budget…' }],
    },
  },
  {
    type: 'result',
    subtype: 'success',
    is_error: true,
    api_error_status: 401,
    result: REVOKED,
    session_id: 'conv-401',
  },
]);

const CODEX_REVOKED = ndjson([
  { type: 'thread.started', thread_id: 'conv-401' },
  {
    type: 'turn.failed',
    error: { message: 'unexpected status 401 Unauthorized: token revoked' },
  },
]);

beforeEach(() => {
  io.stdout = '';
  io.checkpoint = null;
  io.resumedAt = [];
  io.beforeStdout = undefined;
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a brokered task agent turn the vendor answered 401', () => {
  it.each([
    ['claude-code', CLAUDE_REVOKED],
    ['codex', CODEX_REVOKED],
  ])(
    '%s settles as credential_rotated, keeping the conversation and the account',
    async (harness, stdout) => {
      io.stdout = stdout;
      const { ctx, mutations } = makeCtx({
        status: 'running',
        execId: 'exec-1',
        brokerTokenHash: 'stable-selected-account-hash',
      });

      await driveTaskAgentTurnImpl(ctx, { ...KEYS, harness });

      expect(failedMarks(mutations)).toEqual([
        {
          name: 'tasks/agent_runs:markTaskAgentRunFailed',
          args: expect.objectContaining({
            runId: 'run-1',
            execId: 'exec-1',
            failureCode: 'credential_rotated',
            apiErrorStatus: 401,
            // The retry resumes this conversation on a fresh vend.
            agentSessionId: 'conv-401',
          }),
        },
      ]);
      // The account is healthy: a 401 is no rate limit to cool down.
      expect(
        mutations.some(
          (m) =>
            m.name ===
            'provider_credentials/mutations:recordBrokerFailureInternal',
        ),
      ).toBe(false);
      expect(isAutoRetryableFailure('credential_rotated')).toBe(true);
    },
  );

  it('names the revocation in the run error, in the harness’s own words', async () => {
    io.stdout = CLAUDE_REVOKED;
    const { ctx, mutations } = makeCtx({
      status: 'running',
      execId: 'exec-1',
      brokerTokenHash: 'stable-selected-account-hash',
    });

    await driveTaskAgentTurnImpl(ctx, KEYS);

    expect(failedMarks(mutations)[0]?.args.error).toBe(REVOKED);
  });
});

describe('a Codex model-capacity failure', () => {
  it('retains the typed failure after checkpoint restoration without replaying the consumed terminal event', async () => {
    const message =
      'Selected model is at capacity. Please try a different model.';
    io.stdout = ndjson([
      { type: 'thread.started', thread_id: 'checkpoint-conversation' },
      { type: 'turn.failed', error: { message } },
    ]);
    const keys = { ...KEYS, harness: 'codex' };
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    // Permit the real five-second checkpoint throttle, without a slow test.
    io.beforeStdout = () => {
      now += 6_000;
    };
    const first = await drainHarnessWindow(keys).finally(() => {
      clock.mockRestore();
      io.beforeStdout = undefined;
    });
    expect(first.kind).toBe('terminal');
    expect(io.checkpoint).toMatchObject({
      seq: 1,
      state: { ended: { providerErrorKind: 'model_capacity' } },
    });

    // The prior worker saved and acknowledged the terminal chunk before
    // settling the task. The next worker sees only the saved checkpoint.
    io.stdout = '';
    const { ctx, mutations } = makeCtx({
      status: 'running',
      execId: 'exec-1',
      brokerTokenHash: 'healthy-account',
    });
    await driveTaskAgentTurnImpl(ctx, keys);
    expect(io.resumedAt).toEqual([0, 1]);
    expect(failedMarks(mutations)).toEqual([
      {
        name: 'tasks/agent_runs:markTaskAgentRunFailed',
        args: expect.objectContaining({
          failureCode: 'model_capacity',
          error: message,
          agentSessionId: 'checkpoint-conversation',
        }),
      },
    ]);
    expect(failedMarks(mutations)[0]?.args).not.toHaveProperty(
      'apiErrorStatus',
    );
    expect(
      mutations.some(
        (m) =>
          m.name ===
          'provider_credentials/mutations:recordBrokerFailureInternal',
      ),
    ).toBe(false);
  });

  it('retains the conversation and original words without an account-rate-limit mutation', async () => {
    const message =
      'Selected model is at capacity. Please try a different model.';
    io.stdout = ndjson([
      { type: 'thread.started', thread_id: 'capacity-conversation' },
      {
        type: 'item.completed',
        item: {
          id: 'msg',
          type: 'agent_message',
          text: 'I read the task before the provider refused.',
        },
      },
      { type: 'turn.failed', error: { message } },
    ]);
    const { ctx, mutations } = makeCtx({
      status: 'running',
      execId: 'exec-1',
      brokerTokenHash: 'healthy-account',
    });
    await driveTaskAgentTurnImpl(ctx, { ...KEYS, harness: 'codex' });
    expect(failedMarks(mutations)).toEqual([
      {
        name: 'tasks/agent_runs:markTaskAgentRunFailed',
        args: expect.objectContaining({
          failureCode: 'model_capacity',
          error: message,
          agentSessionId: 'capacity-conversation',
        }),
      },
    ]);
    expect(failedMarks(mutations)[0]?.args).not.toHaveProperty(
      'apiErrorStatus',
    );
    expect(
      mutations.some(
        (m) =>
          m.name ===
          'provider_credentials/mutations:recordBrokerFailureInternal',
      ),
    ).toBe(false);
  });
});

describe('a Claude subscription-access refusal', () => {
  it('restores the typed refusal from a consumed terminal checkpoint', async () => {
    io.stdout = ndjson([
      { type: 'system', subtype: 'init', session_id: 'checkpoint-403' },
      {
        type: 'result',
        subtype: 'success',
        is_error: true,
        api_error_status: 403,
        result:
          'Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access',
        session_id: 'checkpoint-403',
      },
    ]);
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    io.beforeStdout = () => {
      now += 6_000;
    };
    await drainHarnessWindow(KEYS).finally(() => {
      clock.mockRestore();
      io.beforeStdout = undefined;
    });
    expect(io.checkpoint).toMatchObject({
      seq: 1,
      state: {
        ended: {
          providerErrorKind: 'subscription_access_disabled',
          apiErrorStatus: 403,
        },
      },
    });
    io.stdout = '';
    const { ctx, mutations } = makeCtx({
      status: 'running',
      execId: 'exec-1',
      brokerTokenHash: 'selected-account',
    });
    await driveTaskAgentTurnImpl(ctx, KEYS);
    expect(io.resumedAt).toEqual([0, 1]);
    expect(mutations).toContainEqual({
      name: 'provider_credentials/mutations:recordBrokerFailureInternal',
      args: {
        organizationId: 'org-1',
        brokerTokenHash: 'selected-account',
        apiErrorStatus: 403,
        providerErrorKind: 'subscription_access_disabled',
      },
    });
    expect(failedMarks(mutations)[0]?.args).toMatchObject({
      failureCode: 'harness_error',
      apiErrorStatus: 403,
      agentSessionId: 'checkpoint-403',
    });
  });

  it('never cools the replacement exec account from a stale drive', async () => {
    io.stdout = ndjson([
      {
        type: 'result',
        is_error: true,
        api_error_status: 403,
        result:
          'Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access',
      },
    ]);
    const { ctx, mutations } = makeCtx({
      status: 'running',
      execId: 'replacement-exec',
      brokerTokenHash: 'replacement-account',
    });
    await driveTaskAgentTurnImpl(ctx, KEYS);
    expect(
      mutations.some(
        (m) =>
          m.name ===
          'provider_credentials/mutations:recordBrokerFailureInternal',
      ),
    ).toBe(false);
    expect(failedMarks(mutations)).toEqual([]);
  });

  it('does not cool an account for an unrelated terminal 403', async () => {
    io.stdout = ndjson([
      {
        type: 'result',
        is_error: true,
        api_error_status: 403,
        result: 'Forbidden',
      },
    ]);
    const { ctx, mutations } = makeCtx({
      status: 'running',
      execId: 'exec-1',
      brokerTokenHash: 'selected-account',
    });
    await driveTaskAgentTurnImpl(ctx, KEYS);
    expect(
      mutations.some(
        (m) =>
          m.name ===
          'provider_credentials/mutations:recordBrokerFailureInternal',
      ),
    ).toBe(false);
    expect(failedMarks(mutations)[0]?.args).toMatchObject({
      failureCode: 'harness_error',
      apiErrorStatus: 403,
    });
  });

  it.each([true, false])(
    'cools only a broker-served account (broker=%s), keeping a counted retry',
    async (brokerServed) => {
      io.stdout = ndjson([
        { type: 'system', subtype: 'init', session_id: 'conv-403' },
        {
          type: 'result',
          subtype: 'success',
          is_error: true,
          api_error_status: 403,
          result:
            'Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access',
          session_id: 'conv-403',
        },
      ]);
      const { ctx, mutations } = makeCtx({
        status: 'running',
        execId: 'exec-1',
        ...(brokerServed ? { brokerTokenHash: 'selected-account' } : {}),
      });
      await driveTaskAgentTurnImpl(ctx, KEYS);
      const feedback = mutations.filter(
        (m) =>
          m.name ===
          'provider_credentials/mutations:recordBrokerFailureInternal',
      );
      expect(feedback).toEqual(
        brokerServed
          ? [
              {
                name: 'provider_credentials/mutations:recordBrokerFailureInternal',
                args: {
                  organizationId: 'org-1',
                  brokerTokenHash: 'selected-account',
                  apiErrorStatus: 403,
                  providerErrorKind: 'subscription_access_disabled',
                },
              },
            ]
          : [],
      );
      expect(failedMarks(mutations)[0]?.args).toMatchObject({
        failureCode: 'harness_error',
        apiErrorStatus: 403,
        agentSessionId: 'conv-403',
      });
      if (brokerServed)
        expect(mutations.indexOf(feedback[0]!)).toBeLessThan(
          mutations.indexOf(failedMarks(mutations)[0]!),
        );
    },
  );
});

describe('a 401 on a turn the broker did not serve', () => {
  it('stays an ordinary harness error — a static key or the gateway rotates nothing', async () => {
    io.stdout = CLAUDE_REVOKED;
    // No broker stamp: the exec was served by a static subscription key or
    // the managed gateway, whose 401 is a credential fault.
    const { ctx, mutations } = makeCtx({ status: 'running', execId: 'exec-1' });

    await driveTaskAgentTurnImpl(ctx, KEYS);

    expect(failedMarks(mutations)[0]?.args).toMatchObject({
      failureCode: 'harness_error',
      apiErrorStatus: 401,
    });
  });
});
