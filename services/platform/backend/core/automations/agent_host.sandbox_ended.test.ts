/**
 * An automation agent turn the sandbox itself ended — the REAL drive
 * window, drain, parser and end classification, with only the sandbox
 * transport, the output harvest and the ctx shim replaced.
 *
 * runnerd ends an exec that printed nothing and used under 1% of one CPU
 * for its stall window (a hung agent CLI), and the spawner reports it as
 * `EXEC_STALLED`. The turn settles as `turn_stalled`, which the stepper
 * never re-kicks, and the run reports it under the wire code a crash has.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import {
  OUT_OF_MEMORY_TURN_REASON,
  STALLED_TURN_REASON,
} from '../chat/external_turn_shared';
import { isWorkflowAgentRetryable } from './agent_retry';
import { agentFailureCodeOf } from './failure';

const io = vi.hoisted(() => ({
  /** What the exec printed, replayed into every drain window. */
  stdout: '',
  stderr: '',
  /** What the exec's stream ended with. */
  result: {} as Record<string, unknown>,
  cancelled: [] as string[],
  /** What each settle asked the output harvest for. */
  harvests: [] as Array<Record<string, unknown>>,
  /** Every path set the session was asked to delete, in order. */
  deletes: [] as string[][],
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
      _body: unknown,
      _signal: AbortSignal,
      callbacks: {
        onStdout?: (chunk: string) => void;
        onStderr?: (chunk: string) => void;
      },
    ) => {
      callbacks.onStdout?.(io.stdout);
      callbacks.onStderr?.(io.stderr);
      return io.result;
    },
    sessionCancelExec: async (_sessionId: string, execId: string) => {
      io.cancelled.push(execId);
      return true;
    },
    sessionDeleteFiles: async (_sessionId: string, paths: string[]) => {
      io.deletes.push(paths);
      return { deleted: paths, skipped: [] };
    },
  };
});
vi.mock('../node_only/sandbox/session_exec', () => ({
  harvestSessionOutput: async (
    _ctx: unknown,
    args: Record<string, unknown>,
  ) => {
    io.harvests.push(args);
    return { files: [], harvestSkipped: [] };
  },
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

function makeCtx(
  opts: { pendingAsk?: typeof ASK; cursorExecId?: string } = {},
) {
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
              execId: opts.cursorExecId ?? KEYS.execId,
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
  // The agent started, said one thing, then went quiet: no result line.
  io.stdout = ndjson([
    { type: 'system', subtype: 'init', session_id: 'conv-1' },
    {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Calling the API…' }] },
    },
  ]);
  io.stderr = '';
  io.cancelled = [];
  io.harvests = [];
  io.deletes = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('an automation agent turn the sandbox ended', () => {
  it('settles a stall as turn_stalled, which the stepper never re-kicks', async () => {
    io.result = endedBySandbox('EXEC_STALLED', 143);
    const { ctx, mutations } = makeCtx();

    await driveWorkflowAgentTurnImpl(ctx, KEYS);

    const settled = called(mutations, 'recordAgentTurnSettled');
    expect(settled).toHaveLength(1);
    expect(settled[0]?.args).toMatchObject({
      execId: KEYS.execId,
      result: {
        errored: true,
        reason: STALLED_TURN_REASON,
        failureCode: 'turn_stalled',
      },
    });
    expect(isWorkflowAgentRetryable('turn_stalled')).toBe(false);
    // The run's public code stays the one a crashed turn has.
    expect(agentFailureCodeOf('turn_stalled')).toBe('turn_crashed');
  });

  it('settles an OOM kill as resource_exhausted, which the stepper re-kicks after a pause', async () => {
    io.result = endedBySandbox('OOM_KILLED', 137);
    const { ctx, mutations } = makeCtx();

    await driveWorkflowAgentTurnImpl(ctx, KEYS);

    expect(called(mutations, 'recordAgentTurnSettled')[0]?.args).toMatchObject({
      execId: KEYS.execId,
      result: {
        errored: true,
        reason: OUT_OF_MEMORY_TURN_REASON,
        failureCode: 'resource_exhausted',
      },
    });
    expect(isWorkflowAgentRetryable('resource_exhausted')).toBe(true);
    expect(agentFailureCodeOf('resource_exhausted')).toBe('turn_crashed');
  });
});
