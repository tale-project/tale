/**
 * An errored automation agent turn settles WITH the harness's conversation
 * handle, so the stepper's auto-retry can resume that conversation instead of
 * re-deriving the node from scratch — the REAL drive window, drain, parser
 * and end classification, with only the sandbox transport, the harvest and
 * the ctx shim replaced (the empty-answer lock's harness).
 *
 * Observed live (2026-09-18): a provider that answered 502 twice and then cut
 * its stream mid-chunk failed a 15-minute `repair_setup` turn twice; each
 * retry began with "The agent is starting up in the sandbox…", re-reading
 * every file the dead turn had already read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';

const io = vi.hoisted(() => ({ stdout: '' }));

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
  providerSlug: 'zai',
  gatewayModel: 'zai/glm-5.3-flash',
  deadlineAt: Date.now() + 60 * 60_000,
};

interface Call {
  name: string;
  args: Record<string, unknown>;
}

function makeCtx() {
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

/** One stream-json line per event. */
function ndjson(lines: Array<Record<string, unknown>>): string {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

const INIT = { type: 'system', subtype: 'init', session_id: 'conv-1' };

beforeEach(() => {
  io.stdout = '';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('an errored automation agent turn', () => {
  it('settles with the conversation handle the harness announced, so the retry resumes it', async () => {
    io.stdout = ndjson([
      INIT,
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [{ type: 'text', text: 'Reading the engine checks…' }],
        },
      },
      {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        result: 'API Error: 502 upstream connect error',
        session_id: 'conv-1',
        total_cost_usd: 0.09,
        usage: { input_tokens: 1200, output_tokens: 40 },
      },
    ]);
    const { ctx, mutations } = makeCtx();
    await driveWorkflowAgentTurnImpl(ctx, KEYS);
    const settled = settledOf(mutations);
    expect(settled).toHaveLength(1);
    expect(settled[0]?.args).toMatchObject({
      execId: KEYS.execId,
      result: {
        errored: true,
        failureCode: 'harness_error',
        agentSessionId: 'conv-1',
      },
    });
  });

  it('leaves the handle off a clean settle — nothing to resume', async () => {
    io.stdout = ndjson([
      INIT,
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [{ type: 'text', text: 'Done: the setup is written.' }],
        },
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Done: the setup is written.',
        session_id: 'conv-1',
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 10 },
      },
    ]);
    const { ctx, mutations } = makeCtx();
    await driveWorkflowAgentTurnImpl(ctx, KEYS);
    const settled = settledOf(mutations);
    expect(settled).toHaveLength(1);
    const result = settled[0]?.args.result as Record<string, unknown>;
    expect(result.errored).toBe(false);
    expect(result).not.toHaveProperty('agentSessionId');
  });
});
