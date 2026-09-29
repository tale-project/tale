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

const io = vi.hoisted(() => ({ stdout: '' }));

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
    drainSessionExecResilient: async (
      _sessionId: string,
      _body: unknown,
      _signal: AbortSignal,
      callbacks: { onStdout?: (chunk: string) => void },
    ) => {
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
