/**
 * An agent turn's drive window on a server that starts shutting down: the
 * window ends at once with the turn still running, the next window is
 * scheduled for whichever process takes it, and the sandbox exec is never
 * cut — the agent keeps working while its turn changes hands.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';

const transport = vi.hoisted(() => ({ cancelled: [] as string[] }));

vi.mock('../node_only/sandbox/helpers/session_client', async (importActual) => {
  const actual =
    await importActual<
      typeof import('../node_only/sandbox/helpers/session_client')
    >();
  return {
    ...actual,
    sessionGetExecCheckpoint: async () => null,
    sessionPutExecCheckpoint: async () => undefined,
    sessionCancelExec: async (_sessionId: string, execId: string) => {
      transport.cancelled.push(execId);
      return true;
    },
    // A live exec: its stream ends only when the window's signal aborts.
    drainSessionExecResilient: async (
      _sessionId: string,
      _body: unknown,
      signal: AbortSignal,
    ) => {
      await new Promise<never>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    },
  };
});

const { driveWorkflowAgentTurnImpl } = await import('./agent_host');

const KEYS = {
  organizationId: 'org-1',
  runId: 'run-1',
  nodeId: 'research',
  execId: 'exec-1',
  sessionId: 'session-1',
  harness: 'claude-code',
  providerSlug: 'anthropic',
  gatewayModel: 'claude-sonnet',
  deadlineAt: Date.now() + 3_600_000,
};

function makeCtx() {
  const mutations: string[] = [];
  const scheduled: Array<{ name: string; delay: number }> = [];
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = functionRefName(ref);
      if (name.endsWith(':readAgentCursor')) {
        return {
          status: 'waiting',
          cursor: { node: KEYS.nodeId, agent: { execId: KEYS.execId } },
        };
      }
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown) => {
      mutations.push(functionRefName(ref).split(':').at(-1) ?? '');
      return null;
    },
    runAction: async () => null,
    scheduler: {
      runAfter: async (delay: number, ref: unknown) => {
        scheduled.push({ name: functionRefName(ref), delay });
        return 'job';
      },
      runAt: async () => 'job',
      cancel: async () => undefined,
    },
  };
  return { ctx: ctx as never, mutations, scheduled };
}

beforeEach(() => {
  transport.cancelled = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('a drive window on a server that is shutting down', () => {
  it('ends running, hands the turn to its next window, and never cuts the exec', async () => {
    const { ctx, mutations, scheduled } = makeCtx();
    const stop = new AbortController();
    const started = Date.now();
    setTimeout(() => stop.abort(), 20);

    await driveWorkflowAgentTurnImpl(ctx, KEYS, { signal: stop.signal });

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(transport.cancelled).toEqual([]);
    expect(scheduled).toEqual([
      { name: 'automations/agent_host:driveWorkflowAgentTurn', delay: 0 },
    ]);
    // The op's heartbeat is renewed, and nothing settles the turn.
    expect(mutations).toContain('upsertSessionOp');
    expect(mutations).not.toContain('claimSessionOpFinalize');
  });

  it('ends at once when the server was already stopping', async () => {
    const { ctx, scheduled } = makeCtx();
    const stop = new AbortController();
    stop.abort();

    await driveWorkflowAgentTurnImpl(ctx, KEYS, { signal: stop.signal });

    expect(transport.cancelled).toEqual([]);
    expect(scheduled).toHaveLength(1);
  });
});
