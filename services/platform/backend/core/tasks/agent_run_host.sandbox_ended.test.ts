/**
 * A task agent turn the sandbox itself ended — the REAL drive host, drain,
 * parser and end classification, with only external I/O replaced.
 *
 * runnerd ends an exec that printed nothing and used under 1% of one CPU
 * for its stall window (a hung agent CLI), and the spawner reports it as
 * `EXEC_STALLED`. That is a hang, not a provider error: the run settles as
 * `turn_stalled`, which no automatic retry follows, and its error says what
 * happened.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { taskRunFailureClass } from '../../../lib/shared/task-run-failure';
import {
  OUT_OF_MEMORY_TURN_REASON,
  STALLED_TURN_REASON,
} from '../chat/external_turn_shared';
import {
  isAutoRetryableFailure,
  resourceExhaustedRetryDelayMs,
} from './task_auto_retry';

const io = vi.hoisted(() => ({
  stdout: '',
  stderr: '',
  /** What the exec's stream ended with. */
  result: {} as Record<string, unknown>,
  /** Every exec the drain was asked to START (not re-attach), in order. */
  starts: [] as Array<{ execId: string; argv: string[] }>,
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
    sessionGetExecCheckpoint: async () => null,
    sessionPutExecCheckpoint: async () => undefined,
    drainSessionExecResilient: async (
      _sessionId: string,
      body: { execId: string; command?: string[] },
      _signal: AbortSignal,
      callbacks: {
        onStdout?: (chunk: string) => void;
        onStderr?: (chunk: string) => void;
      },
    ) => {
      if (body.command !== undefined) {
        io.starts.push({ execId: body.execId, argv: body.command });
      }
      callbacks.onStdout?.(io.stdout);
      callbacks.onStderr?.(io.stderr);
      return io.result;
    },
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
    modelId: 'glm',
  }),
}));
vi.mock('../lib/providers/resolve_model', () => ({
  resolveModel: async () => {
    throw new Error('no catalog entry in this test');
  },
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
          title: 'Answer the reviewer',
          attachments: [],
          outputs: [],
          discussion: [],
        };
      }
      if (name === 'sandbox/session_queries:getSessionOpAttribution') {
        return { userId: 'user-starter' };
      }
      if (name === 'governance/queries:getContextCapInternal') return null;
      // An editor's run: the agent's full equipment.
      if (name === 'tasks/agent_runs:getTaskAgentRunAuthority') {
        return { confined: false };
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
      if (name === 'tasks/agent_runs:markTaskAgentRunFailed') {
        run.status = 'failed';
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

/** An exec result the sandbox ended with `errorCode`. */
function endedBySandbox(errorCode: string, exitCode: number | null) {
  return {
    status: 'failed',
    exitCode,
    durationMs: 2_700_000,
    stdoutBase64: '',
    stderrBase64: '',
    truncated: { stdout: false, stderr: false },
    errorCode,
    errorMessage: 'ended by the sandbox',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The agent started, said one thing, then went quiet: no result line.
  io.stdout = ndjson([
    { type: 'system', subtype: 'init', session_id: 'conv-stall' },
    {
      type: 'assistant',
      message: {
        id: 'msg_1',
        content: [{ type: 'text', text: 'Waiting for the API to answer…' }],
      },
    },
  ]);
  io.stderr = '';
  io.starts = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a task agent turn the sandbox ended as stalled', () => {
  it('settles as turn_stalled with the stall named, and is not auto-retried', async () => {
    io.result = endedBySandbox('EXEC_STALLED', 143);
    io.stderr = 'polling https://api.example.test …\n';
    const run: RunState = { status: 'running', execId: 'exec-1' };
    const { ctx, mutations } = makeCtx(run);

    await driveTaskAgentTurnImpl(ctx, KEYS);

    const failed = failedMarks(mutations);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.args).toMatchObject({
      runId: 'run-1',
      execId: 'exec-1',
      failureCode: 'turn_stalled',
    });
    expect(String(failed[0]?.args.error)).toBe(
      `${STALLED_TURN_REASON} Last output: polling https://api.example.test …`,
    );
    expect(isAutoRetryableFailure('turn_stalled')).toBe(false);
    expect(taskRunFailureClass('turn_stalled')).toBe('stalled');
  });

  it.each(['OOM_KILLED', 'SESSION_OOM'])(
    'settles %s as resource_exhausted, retried only after a pause',
    async (code) => {
      io.result = endedBySandbox(code, 137);
      const { ctx, mutations } = makeCtx({
        status: 'running',
        execId: 'exec-1',
      });

      await driveTaskAgentTurnImpl(ctx, KEYS);

      const failed = failedMarks(mutations);
      expect(failed[0]?.args).toMatchObject({
        failureCode: 'resource_exhausted',
        error: OUT_OF_MEMORY_TURN_REASON,
      });
      expect(isAutoRetryableFailure('resource_exhausted')).toBe(true);
      expect(taskRunFailureClass('resource_exhausted')).toBe('out_of_memory');
      expect(
        [undefined, 1, 2, 7].map((attempt) =>
          resourceExhaustedRetryDelayMs(attempt),
        ),
      ).toEqual([120_000, 600_000, 1_800_000, 1_800_000]);
    },
  );

  it('keeps an ordinary crash a retryable harness error', async () => {
    io.result = endedBySandbox('RUNTIME_ERROR', 1);
    const { ctx, mutations } = makeCtx({ status: 'running', execId: 'exec-1' });

    await driveTaskAgentTurnImpl(ctx, KEYS);

    expect(failedMarks(mutations)[0]?.args.failureCode).toBe('harness_error');
  });
});
