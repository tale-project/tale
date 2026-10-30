/**
 * An automation agent turn that Codex ends on its terminal model-capacity
 * refusal (pinned CLI 0.160.0: `turn.failed` "Selected model is at
 * capacity. Please try a different model.") — the REAL drive window, drain,
 * Codex parser and end classification, with only the sandbox transport, the
 * harvest and the ctx shim replaced; then the kick that holds its retry.
 *
 * The model refused everyone: nothing says the account is faulty, so the
 * turn settles `model_capacity` from the parser's typed kind — never an
 * invented 429, never from text the agent or a tool printed — keeps its
 * conversation, and cools no account down. The re-kick's start waits out
 * the delay with the claim of the walker that kicked it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import type { ActionCtx } from '../lib/ctx';
import type { AgentTurnServing } from '../lib/providers/agent_serving';
import { MODEL_CAPACITY_REKICK_DELAY_MS } from './agent_retry';

const io = vi.hoisted(() => ({
  stdout: '',
  checkpoint: null as { seq: number; state: unknown } | null,
  resumedAt: [] as number[],
  beforeStdout: undefined as (() => void) | undefined,
}));

vi.mock('../node_only/sandbox/helpers/session_client', async (importActual) => {
  const actual =
    await importActual<
      typeof import('../node_only/sandbox/helpers/session_client')
    >();
  return {
    ...actual,
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
  };
});
vi.mock('../node_only/sandbox/session_exec', () => ({
  harvestSessionOutput: async () => ({ files: [], harvestSkipped: [] }),
}));

const { automationAgentHost, driveWorkflowAgentTurnImpl } =
  await import('./agent_host');
const { drainHarnessWindow } = await import('../chat/external_turn_shared');

const CAPACITY = 'Selected model is at capacity. Please try a different model.';

const KEYS = {
  organizationId: 'org-1',
  runId: 'run-1',
  nodeId: 'triage',
  execId: 'exec-1',
  sessionId: 'wf-run-1',
  harness: 'codex',
  providerSlug: 'openai',
  gatewayModel: 'gpt-5.1-codex',
  deadlineAt: Date.now() + 60 * 60_000,
};

interface Call {
  name: string;
  args: Record<string, unknown>;
}

/** The run parked on this turn, served by the broker's `healthy-account`. */
function makeCtx(parked: { resumedFrom?: string } = {}) {
  const mutations: Call[] = [];
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = functionRefName(ref);
      if (name === 'automations/queries:readAgentCursor') {
        return {
          status: 'waiting',
          cursor: {
            node: KEYS.nodeId,
            agent: {
              execId: KEYS.execId,
              sessionId: KEYS.sessionId,
              deadlineAt: KEYS.deadlineAt,
              providerSlug: KEYS.providerSlug,
              gatewayModel: KEYS.gatewayModel,
              harness: KEYS.harness,
              brokerTokenHash: 'healthy-account',
              ...parked,
              input: {},
            },
          },
        };
      }
      if (name === 'automations/human_asks:getPendingAskForExec') return null;
      if (name === 'sandbox/session_queries:getExternalTurnOpForFinalize') {
        return { execId: KEYS.execId };
      }
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      mutations.push({ name, args });
      if (name === 'sandbox/session_mutations:claimSessionOpFinalize') {
        return true;
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

const settledOf = (mutations: Call[]) =>
  mutations.filter((m) => m.name.endsWith(':recordAgentTurnSettled'));

const cooledDown = (mutations: Call[]) =>
  mutations.some(
    (m) =>
      m.name === 'provider_credentials/mutations:recordBrokerFailureInternal',
  );

/** One JSONL line per event, as `codex exec --json` prints them. */
function jsonl(lines: Array<Record<string, unknown>>): string {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

beforeEach(() => {
  vi.clearAllMocks();
  io.stdout = '';
  io.checkpoint = null;
  io.resumedAt = [];
  io.beforeStdout = undefined;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('an automation agent turn Codex ends because the model is at capacity', () => {
  it('settles as model_capacity with its conversation and words, and cools no account down', async () => {
    io.stdout = jsonl([
      { type: 'thread.started', thread_id: 'thr-1' },
      { type: 'turn.started' },
      {
        type: 'item.completed',
        item: {
          id: 'msg-1',
          type: 'agent_message',
          text: 'I read the inbox before the provider refused.',
        },
      },
      { type: 'turn.failed', error: { message: CAPACITY } },
    ]);
    const { ctx, mutations } = makeCtx();

    await driveWorkflowAgentTurnImpl(ctx, KEYS);

    const settled = settledOf(mutations);
    expect(settled).toHaveLength(1);
    expect(settled[0]?.args).toMatchObject({
      execId: KEYS.execId,
      result: {
        errored: true,
        failureCode: 'model_capacity',
        reason: CAPACITY,
        agentSessionId: 'thr-1',
      },
    });
    // No HTTP status was reported, and none is made up.
    expect(settled[0]?.args.result).not.toHaveProperty('apiErrorStatus');
    expect(cooledDown(mutations)).toBe(false);
  });

  it('settles a resumed conversation the model refused again the same way, keeping it', async () => {
    // The retry resumed `thr-1`; Codex announces the resumed thread again
    // before the provider refuses the turn.
    io.stdout = jsonl([
      { type: 'thread.started', thread_id: 'thr-1' },
      { type: 'turn.started' },
      { type: 'turn.failed', error: { message: CAPACITY } },
    ]);
    const { ctx, mutations } = makeCtx({ resumedFrom: 'thr-1' });

    await driveWorkflowAgentTurnImpl(ctx, KEYS);

    expect(settledOf(mutations)[0]?.args).toMatchObject({
      result: {
        errored: true,
        failureCode: 'model_capacity',
        agentSessionId: 'thr-1',
      },
    });
    expect(cooledDown(mutations)).toBe(false);
  });

  it('keeps the typed refusal when a later window restores the checkpoint that consumed it', async () => {
    io.stdout = jsonl([
      { type: 'thread.started', thread_id: 'thr-restored' },
      { type: 'turn.failed', error: { message: CAPACITY } },
    ]);
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    // Let the real five-second checkpoint throttle pass without waiting.
    io.beforeStdout = () => {
      now += 6_000;
    };
    const first = await drainHarnessWindow(KEYS).finally(() => {
      clock.mockRestore();
      io.beforeStdout = undefined;
    });
    expect(first.kind).toBe('terminal');
    expect(io.checkpoint).toMatchObject({
      seq: 1,
      state: { ended: { providerErrorKind: 'model_capacity' } },
    });

    // The window that read the terminal line died before its settle. The
    // next one sees only the saved checkpoint: the line is not replayed.
    io.stdout = '';
    const { ctx, mutations } = makeCtx();
    await driveWorkflowAgentTurnImpl(ctx, KEYS);

    expect(io.resumedAt).toEqual([0, 1]);
    expect(settledOf(mutations)).toHaveLength(1);
    expect(settledOf(mutations)[0]?.args).toMatchObject({
      result: {
        errored: true,
        failureCode: 'model_capacity',
        reason: CAPACITY,
        agentSessionId: 'thr-restored',
      },
    });
    expect(settledOf(mutations)[0]?.args.result).not.toHaveProperty(
      'apiErrorStatus',
    );
    expect(cooledDown(mutations)).toBe(false);
  });

  it('classifies nothing the agent or a tool printed, nor a transient stream error', async () => {
    // The sentence as the agent's own words and as a tool's output, then an
    // ordinary provider failure: that failure decides, as it always did.
    io.stdout = jsonl([
      { type: 'thread.started', thread_id: 'thr-2' },
      {
        type: 'item.completed',
        item: { id: 'msg-1', type: 'agent_message', text: CAPACITY },
      },
      {
        type: 'item.completed',
        item: {
          id: 'cmd-1',
          type: 'command_execution',
          command: 'cat notes.txt',
          aggregated_output: CAPACITY,
          exit_code: 0,
          status: 'completed',
        },
      },
      { type: 'turn.failed', error: { message: 'stream disconnected' } },
    ]);
    const failed = makeCtx();
    await driveWorkflowAgentTurnImpl(failed.ctx, KEYS);
    expect(settledOf(failed.mutations)[0]?.args).toMatchObject({
      result: { errored: true, failureCode: 'harness_error' },
    });

    // A reconnect notice that quotes it, then a turn that completes.
    io.stdout = jsonl([
      { type: 'thread.started', thread_id: 'thr-3' },
      { type: 'error', message: CAPACITY },
      {
        type: 'item.completed',
        item: { id: 'msg-2', type: 'agent_message', text: 'Triaged.' },
      },
      {
        type: 'turn.completed',
        usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2 },
      },
    ]);
    const completed = makeCtx();
    await driveWorkflowAgentTurnImpl(completed.ctx, KEYS);
    const result = settledOf(completed.mutations)[0]?.args.result as Record<
      string,
      unknown
    >;
    expect(result).toMatchObject({ errored: false, text: 'Triaged.' });
    expect(result).not.toHaveProperty('failureCode');
  });
});

describe('the re-kick of a node the model refused', () => {
  const kickArgs = {
    runId: 'run-1',
    nodeId: 'triage',
    request: {
      model: 'gpt-5.1-codex',
      harness: 'codex',
      prompt: 'Triage the inbox.',
    },
    excludeBrokerTokenHashes: ['account-a'],
    resume: { agentSessionId: 'thr-1', reason: CAPACITY },
    claimEpoch: 7,
  };

  /** The subscription serving the model resolves to: no provider walk. */
  const serving: AgentTurnServing = {
    lane: 'subscription',
    providerSlug: 'openai',
    modelId: 'gpt-5.1-codex',
    apiBaseUrl: 'https://api.openai.com/v1',
    vision: { readable: true },
  };
  const resolveServing = async () => serving;

  function kickCtx() {
    const order: string[] = [];
    const scheduled: Array<{ delayMs: number; args: Record<string, unknown> }> =
      [];
    const runMutation = vi.fn(async (ref: unknown, _args: unknown) => {
      order.push(functionRefName(ref));
      return null;
    });
    const ctx = {
      runQuery: vi.fn(async () => null),
      runMutation,
      runAction: vi.fn(async () => null),
      scheduler: {
        runAfter: async (
          delayMs: number,
          ref: unknown,
          args: Record<string, unknown>,
        ) => {
          order.push(`schedule ${functionRefName(ref)}`);
          scheduled.push({ delayMs, args });
          return 'job';
        },
      },
    } as unknown as ActionCtx;
    return { ctx, runMutation, order, scheduled };
  }

  it('holds its start for the delay, with the conversation, the accounts to step past and the claim of the walker that kicked it', async () => {
    const { ctx, runMutation, order, scheduled } = kickCtx();
    const notBefore = Date.now() + MODEL_CAPACITY_REKICK_DELAY_MS;

    const kicked = await automationAgentHost(ctx, 'org-1', {
      resolveServing,
    }).kick({ ...kickArgs, notBefore });

    // The op row first, so a start that dies is still a turn the watchdog
    // can see; then the one start, held in the queue.
    expect(order).toEqual([
      'sandbox/session_mutations:upsertSessionOp',
      'schedule automations/agent_host:startWorkflowAgentTurn',
    ]);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delayMs).toBeGreaterThan(
      MODEL_CAPACITY_REKICK_DELAY_MS - 5_000,
    );
    expect(scheduled[0]?.delayMs).toBeLessThanOrEqual(
      MODEL_CAPACITY_REKICK_DELAY_MS,
    );
    expect(scheduled[0]?.args).toMatchObject({
      organizationId: 'org-1',
      runId: 'run-1',
      nodeId: 'triage',
      execId: kicked.execId,
      excludeBrokerTokenHashes: ['account-a'],
      resume: { agentSessionId: 'thr-1', reason: CAPACITY },
      claimEpoch: 7,
    });
    // The turn's deadline runs from the end of the hold.
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      execId: kicked.execId,
      kind: 'workflow-agent',
      status: 'running',
      deadlineMs: kicked.deadlineAt,
    });
    expect(kicked.deadlineAt).toBeGreaterThanOrEqual(notBefore);
  });

  it('starts a kick it does not hold at once, carrying no claim to check', async () => {
    const { ctx, scheduled } = kickCtx();

    await automationAgentHost(ctx, 'org-1', { resolveServing }).kick(kickArgs);

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delayMs).toBe(0);
    expect(scheduled[0]?.args).not.toHaveProperty('claimEpoch');
  });
});
