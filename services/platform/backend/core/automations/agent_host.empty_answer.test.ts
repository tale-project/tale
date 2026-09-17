/**
 * An automation agent turn whose model answered nothing settles as a failure
 * the stepper retries — the REAL drive window, drain, parser and end
 * classification, with only the sandbox transport, the output harvest and the
 * ctx shim replaced.
 *
 * Observed live (2026-09-17): a serving cluster that failed mid-prefill
 * answered a 200 with an empty message; Claude Code ended the turn cleanly
 * with no assistant message, the node settled `ok` with empty text, and the
 * workflow went on as if the agent had deliberately changed nothing. A turn
 * that only called a tool — the question tool included, which parks the run
 * instead — still ends as before.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readFixture } from '../../../lib/harnesses/test-helpers';
import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { EMPTY_ANSWER_REASON } from '../chat/external_turn_shared';
import { isWorkflowAgentRetryable } from './agent_retry';

const io = vi.hoisted(() => ({
  /** What the exec printed, replayed into every drain window. */
  stdout: '',
  cancelled: [] as string[],
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
    sessionCancelExec: async (_sessionId: string, execId: string) => {
      io.cancelled.push(execId);
      return true;
    },
  };
});
vi.mock('../node_only/sandbox/session_exec', () => ({
  harvestSessionOutput: async () => ({ files: [], harvestSkipped: [] }),
}));

const { driveWorkflowAgentTurnImpl } = await import('./agent_host');

const KEYS = {
  organizationId: 'org-1',
  runId: 'run-1',
  nodeId: 'repair_setup',
  execId: 'exec-1',
  sessionId: 'wf-run-1',
  harness: 'claude-code',
  providerSlug: 'local-inference',
  gatewayModel: 'local-inference/glm',
  deadlineAt: Date.now() + 60 * 60_000,
};

const ASK = {
  _id: 'ask-1',
  runId: KEYS.runId,
  nodeId: KEYS.nodeId,
  execId: KEYS.execId,
  question: 'Which VAT code applies to the new supplier?',
  expiresAt: Date.now() + 7 * 24 * 60 * 60_000,
  status: 'pending',
};

interface Call {
  name: string;
  args: Record<string, unknown>;
}

function makeCtx(opts: { pendingAsk?: typeof ASK } = {}) {
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
              input: {},
            },
          },
        };
      }
      if (name === 'automations/human_asks:getPendingAskForExec') {
        return opts.pendingAsk ?? null;
      }
      if (name === 'sandbox/session_queries:getExternalTurnOpForFinalize') {
        // No gateway key on this op: nothing to book or revoke.
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

const called = (mutations: Call[], name: string) =>
  mutations.filter((m) => m.name.endsWith(`:${name}`));

/** One stream-json line per event. */
function ndjson(lines: Array<Record<string, unknown>>): string {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

/** A clean result that reports nothing — a gateway that sends no usage. */
const SILENT_RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '',
  session_id: 'conv-1',
  total_cost_usd: 0,
  usage: { input_tokens: 0, output_tokens: 0 },
};

beforeEach(() => {
  io.stdout = '';
  io.cancelled = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('an automation agent turn', () => {
  it('fails, retryably, when the model answered nothing', async () => {
    io.stdout = `${readFixture('claude-code', 'empty-answer-turn')}\n`;
    const { ctx, mutations } = makeCtx();

    await driveWorkflowAgentTurnImpl(ctx, KEYS);

    const settled = called(mutations, 'recordAgentTurnSettled');
    expect(settled).toHaveLength(1);
    expect(settled[0]?.args).toMatchObject({
      runId: KEYS.runId,
      nodeId: KEYS.nodeId,
      execId: KEYS.execId,
      result: {
        errored: true,
        reason: EMPTY_ANSWER_REASON,
        failureCode: 'harness_error',
        text: '',
        files: [],
      },
    });
    // The stepper re-kicks a `harness_error` within its in-node budget.
    expect(isWorkflowAgentRetryable('harness_error')).toBe(true);
    // The op row goes terminal as failed, not completed.
    expect(called(mutations, 'upsertSessionOp').at(-1)?.args).toMatchObject({
      execId: KEYS.execId,
      status: 'failed',
    });
  });

  it('still settles a turn that only called a tool', async () => {
    io.stdout = ndjson([
      { type: 'system', subtype: 'init', session_id: 'conv-1' },
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Write',
              input: { file_path: '/agent/output/profile.yaml' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: 'File written',
              is_error: false,
            },
          ],
        },
      },
      SILENT_RESULT,
    ]);
    const { ctx, mutations } = makeCtx();

    await driveWorkflowAgentTurnImpl(ctx, KEYS);

    const settled = called(mutations, 'recordAgentTurnSettled');
    expect(settled).toHaveLength(1);
    const result = settled[0]?.args.result;
    expect(result).toMatchObject({ errored: false, text: '' });
    expect(result).not.toHaveProperty('reason');
    expect(result).not.toHaveProperty('failureCode');
  });

  it('parks a turn that asked the operator and then said nothing', async () => {
    io.stdout = ndjson([
      { type: 'system', subtype: 'init', session_id: 'conv-1' },
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_ask',
              name: 'mcp__connectors__workspace_tool',
              input: { tool: 'ask_human', args: { question: ASK.question } },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_ask',
              content: 'Question recorded. End your turn and wait.',
              is_error: false,
            },
          ],
        },
      },
      SILENT_RESULT,
    ]);
    const { ctx, mutations } = makeCtx({ pendingAsk: ASK });

    await driveWorkflowAgentTurnImpl(ctx, KEYS);

    expect(called(mutations, 'recordAskParked')).toEqual([
      {
        name: 'automations/human_asks:recordAskParked',
        args: { askId: ASK._id, agentSessionId: 'conv-1' },
      },
    ]);
    expect(called(mutations, 'closeAsk')).toEqual([]);
    expect(called(mutations, 'recordAgentTurnSettled')).toEqual([]);
    expect(called(mutations, 'upsertSessionOp').at(-1)?.args).toMatchObject({
      status: 'completed',
      agentResultStatus: 'awaiting_human',
    });
  });
});
