/**
 * A task agent turn whose model answered nothing — the REAL start and drive
 * hosts, drain, parser and end classification, with only external I/O
 * replaced.
 *
 *  - it fails retryably on the lane's `empty_turn` path, naming the empty
 *    answer, and keeps the conversation handle so the retry resumes it;
 *  - on a RESUMED start it is not a dead handle: the pinned CLI announces the
 *    resumed conversation's own id, so the start must not throw the live
 *    conversation away and relaunch fresh.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readFixture } from '../../../lib/harnesses/test-helpers';
import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { EMPTY_ANSWER_REASON } from '../chat/external_turn_shared';
import { isAutoRetryableFailure } from './task_auto_retry';

/** The conversation the captured empty answer announces. */
const CONVERSATION = '1ada8c8a-113e-4b8b-b46c-b3a1c23c12c6';

const io = vi.hoisted(() => ({
  stdout: '',
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
  workflowAgentBudgetCents: () => 500,
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
      body: { execId: string; command?: string[] },
      _signal: AbortSignal,
      callbacks: { onStdout?: (chunk: string) => void },
    ) => {
      if (body.command !== undefined) {
        io.starts.push({ execId: body.execId, argv: body.command });
      }
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

const { driveTaskAgentTurnImpl, startTaskAgentTurnImpl } =
  await import('./agent_run_host');

interface RunState {
  status: string;
  execId: string;
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

beforeEach(() => {
  io.stdout = `${readFixture('claude-code', 'empty-answer-turn')}\n`;
  io.starts = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a task agent turn whose model answered nothing', () => {
  it('fails retryably, naming the empty answer and keeping the conversation', async () => {
    const run: RunState = { status: 'running', execId: 'exec-1' };
    const { ctx, mutations } = makeCtx(run);

    await driveTaskAgentTurnImpl(ctx, KEYS);

    expect(failedMarks(mutations).map((m) => m.args)).toEqual([
      {
        runId: 'run-1',
        execId: 'exec-1',
        error: EMPTY_ANSWER_REASON,
        failureCode: 'empty_turn',
        agentSessionId: CONVERSATION,
      },
    ]);
    expect(isAutoRetryableFailure('empty_turn')).toBe(true);
  });

  it('keeps a resumed conversation instead of relaunching it fresh', async () => {
    const run: RunState = { status: 'queued', execId: 'exec-1' };
    const { ctx, mutations } = makeCtx(run);

    await startTaskAgentTurnImpl(ctx, {
      ...KEYS,
      model: 'glm',
      modelProvider: 'local-inference',
      skills: [],
      connectors: [],
      tools: [],
      secrets: [],
      resume: CONVERSATION,
      resumeSessionCreatedAt: 1000,
      sweep: false,
    });

    // One launch, and it was the resume.
    expect(io.starts).toHaveLength(1);
    expect(io.starts[0]?.argv).toContain('--resume');
    expect(console.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('restarting fresh'),
    );
    expect(failedMarks(mutations).map((m) => m.args)).toEqual([
      {
        runId: 'run-1',
        execId: 'exec-1',
        error: EMPTY_ANSWER_REASON,
        failureCode: 'empty_turn',
        agentSessionId: CONVERSATION,
        sessionCreatedAt: 1000,
      },
    ]);
  });
});
