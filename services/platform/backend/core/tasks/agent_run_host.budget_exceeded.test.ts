/**
 * A task agent turn the gateway refused mid-turn with 402 — the REAL drive
 * host, drain, parser and end classification, with only external I/O
 * replaced.
 *
 * Observed live (2026-09-20): a turn's key was minted at what the org's
 * spend cap had left; the gateway refused the 43rd call with `402
 * budget_exceeded`, the host settled it `harness_error`, and the auto-retry
 * resumed the same transcript three times on 1-cent keys — each died on its
 * second call. A spend refusal is money, not weather: it settles as
 * `budget_exceeded`, which the retry gate never re-kicks, and the run row
 * names the exhausted allowance.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { isAutoRetryableFailure } from './task_auto_retry';

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

const { driveTaskAgentTurnImpl } = await import('./agent_run_host');

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

const REFUSAL =
  'API Error: 402 Model-level budget exceeded (virtual key scope): Model:AllModels:virtual_key:vk-1 budget exceeded: 1.5618 >= 1.5100 dollars';

beforeEach(() => {
  io.stdout = ndjson([
    { type: 'system', subtype: 'init', session_id: 'conv-402' },
    {
      type: 'assistant',
      message: {
        id: 'msg_1',
        content: [{ type: 'text', text: 'Refining the transform…' }],
      },
    },
    {
      type: 'result',
      subtype: 'success',
      is_error: true,
      api_error_status: 402,
      result: REFUSAL,
      session_id: 'conv-402',
      total_cost_usd: 1.56,
      usage: { input_tokens: 4_800_000, output_tokens: 97_000 },
    },
  ]);
  io.starts = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a task agent turn the gateway refused with 402', () => {
  it('settles as budget_exceeded, names the exhausted allowance, and is not auto-retried', async () => {
    const run: RunState = { status: 'running', execId: 'exec-1' };
    const { ctx, mutations } = makeCtx(run);

    await driveTaskAgentTurnImpl(ctx, KEYS);

    expect(failedMarks(mutations).map((m) => m.args)).toEqual([
      {
        runId: 'run-1',
        execId: 'exec-1',
        error: `the turn's spend allowance was exhausted (API status 402): ${REFUSAL}`,
        failureCode: 'budget_exceeded',
        apiErrorStatus: 402,
        agentSessionId: 'conv-402',
      },
    ]);
    expect(isAutoRetryableFailure('budget_exceeded')).toBe(false);
  });
});
