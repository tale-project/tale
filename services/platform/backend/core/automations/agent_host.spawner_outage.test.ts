/**
 * An automation agent turn whose sandbox spawner goes away mid-turn — a
 * restart, a crash, a partition — while runnerd keeps the agent running in
 * its session: the REAL drive window, resilient drain, harness parser and
 * settle, over a fake spawner transport (`fetch`), with only the checkpoint
 * store, the reaps and the ctx shim replaced.
 *
 *  - the spawner dies under the exec's stream and then refuses every
 *    connection: the window ends `running` instead of failing the turn, the
 *    next window comes after a pause and carries when the outage began,
 *    nothing is cut, and once the spawner answers again the next window
 *    resumes after the checkpoint and the turn settles exactly once;
 *  - an outage that outlasts its budget reaps the exec and settles the turn
 *    failed exactly once, scheduling no further window.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { SPAWNER_OUTAGE_BUDGET_MS } from '../chat/external_turn_shared';

const io = vi.hoisted(() => ({
  cancelled: [] as string[],
  /** The checkpoint the windows acknowledged, as the daemon keeps it. */
  checkpoint: null as { seq: number; state: unknown } | null,
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
      io.checkpoint = checkpoint;
    },
    sessionCancelExec: async (_sessionId: string, execId: string) => {
      io.cancelled.push(execId);
      return true;
    },
    sessionDeleteFiles: async (_sessionId: string, paths: string[]) => ({
      deleted: paths,
      skipped: [],
    }),
  };
});
vi.mock('../node_only/sandbox/session_exec', () => ({
  harvestSessionOutput: async () => ({ files: [], harvestSkipped: [] }),
}));

const { driveWorkflowAgentTurnImpl } = await import('./agent_host');

const KEYS = {
  organizationId: 'org-1',
  runId: 'run-1',
  nodeId: 'reconcile',
  execId: 'exec-1',
  sessionId: 'wf-run-1',
  harness: 'claude-code',
  providerSlug: 'anthropic',
  gatewayModel: 'claude-sonnet',
  deadlineAt: Date.now() + 60 * 60_000,
};

interface Call {
  name: string;
  args: Record<string, unknown>;
}

function makeCtx() {
  const mutations: Call[] = [];
  const scheduled: Array<{
    name: string;
    delay: number;
    args: Record<string, unknown>;
  }> = [];
  // The real finalize claim and cursor record: the first settle of the exec
  // wins the claim, and its result lands on the cursor.
  let finalizeClaimed = false;
  let result: unknown;
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
              ...(result !== undefined ? { result } : {}),
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
        const won = !finalizeClaimed;
        finalizeClaimed = true;
        return won;
      }
      if (name === 'automations/mutations:recordAgentTurnSettled') {
        result ??= args.result;
      }
      return null;
    },
    runAction: async () => null,
    scheduler: {
      runAfter: async (
        delay: number,
        ref: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push({ name: functionRefName(ref), delay, args });
        return 'job';
      },
      runAt: async () => 'job',
      cancel: async () => undefined,
    },
  };
  return { ctx: ctx as never, mutations, scheduled };
}

const settled = (mutations: Call[]) =>
  mutations.filter((m) => m.name.endsWith(':recordAgentTurnSettled'));

/** A drive window that ends after `ms`, as its 90-second window would. */
function windowOf(ms: number): AbortSignal {
  const end = new AbortController();
  setTimeout(() => end.abort(), ms);
  return end.signal;
}

/** The Claude Code stream-json lines of a turn that reconciles invoices. */
const LINES = [
  { type: 'system', subtype: 'init', session_id: 'conv-1' },
  {
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Reconciled 12 invoices.' }] },
  },
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Reconciled 12 invoices.',
    session_id: 'conv-1',
    usage: { input_tokens: 10, output_tokens: 5 },
  },
].map((line) => `${JSON.stringify(line)}\n`);

const stdout = (seq: number) =>
  `event: stdout\ndata: ${JSON.stringify({ text: LINES[seq - 1], seq })}\n\n`;

const RESULT = `event: result\ndata: ${JSON.stringify({
  status: 'completed',
  exitCode: 0,
  durationMs: 1,
  stdoutBase64: '',
  stderrBase64: '',
  truncated: { stdout: false, stderr: false },
})}\n\n`;

const enc = new TextEncoder();

/** An exec stream that delivers `blocks` and then, unless it `ends`, breaks
 * the way Node's fetch reports a spawner that died under it. */
function sse(blocks: string[], ends: boolean): Response {
  let delivered = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!delivered) {
          delivered = true;
          for (const block of blocks) controller.enqueue(enc.encode(block));
          if (ends) controller.close();
          return;
        }
        controller.error(new TypeError('terminated'));
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

/** What Node's fetch throws when nothing listens on the spawner's port. */
function refused(): TypeError {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.3:8003'), {
      code: 'ECONNREFUSED',
    }),
  });
}

const spawner = {
  /** `up` serves the exec, `down` refuses every connection. */
  state: 'up' as 'up' | 'down',
  /** The attach paths asked, query included. */
  attaches: [] as string[],
  /** The blocks the next attach serves, and whether its stream then ends. */
  serve: { blocks: [] as string[], ends: true },
};

const origFetch = globalThis.fetch;
const origToken = process.env.SANDBOX_TOKEN;

beforeEach(() => {
  io.cancelled = [];
  io.checkpoint = null;
  spawner.state = 'up';
  spawner.attaches = [];
  process.env.SANDBOX_TOKEN = 'spawner-outage-test';
  // spawnerFetch hands fetch the URL as a string.
  globalThis.fetch = (async (url: string) => {
    if (!url.includes(`/exec/${KEYS.execId}/attach`))
      throw new Error(`unexpected spawner call ${url}`);
    spawner.attaches.push(url.slice(url.indexOf('/attach')));
    if (spawner.state === 'down') throw refused();
    const { blocks, ends } = spawner.serve;
    // The spawner that served this attach dies under it: what follows is
    // refused until it is back.
    if (!ends) spawner.state = 'down';
    return sse(blocks, ends);
  }) as typeof fetch;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = origFetch;
  if (origToken === undefined) delete process.env.SANDBOX_TOKEN;
  else process.env.SANDBOX_TOKEN = origToken;
  vi.restoreAllMocks();
});

describe('an automation agent turn whose spawner goes away', () => {
  it('rides out the restart across windows, resumes after the checkpoint and settles once', async () => {
    vi.useFakeTimers();
    const { ctx, mutations, scheduled } = makeCtx();
    const before = Date.now();
    // The agent's first line arrives, then the spawner dies under the
    // stream and refuses every connection for the rest of the window.
    spawner.serve = { blocks: [stdout(1)], ends: false };

    // Drive the retry clock, rather than asking a busy worker to fit both
    // backoffs into 900 ms of wall time.
    const firstWindow = driveWorkflowAgentTurnImpl(ctx, KEYS, {
      signal: windowOf(900),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(spawner.attaches).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(spawner.attaches).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(150);
    await firstWindow;

    // The drain kept asking (250 ms, then 500 ms) instead of spending its
    // budget of five failures, and the window ended with the turn running.
    expect(spawner.attaches.length).toBeGreaterThanOrEqual(3);
    expect(io.cancelled).toEqual([]);
    expect(settled(mutations)).toEqual([]);
    expect(io.checkpoint?.seq).toBe(1);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({
      name: 'automations/agent_host:driveWorkflowAgentTurn',
      delay: 5_000,
    });
    const since = scheduled[0]?.args.spawnerOutageSince;
    expect(since).toBeGreaterThanOrEqual(before);

    // The spawner is back for the next window, which attaches after the
    // checkpoint and sees the rest of the turn.
    spawner.state = 'up';
    spawner.attaches = [];
    spawner.serve = { blocks: [stdout(2), stdout(3), RESULT], ends: true };
    await driveWorkflowAgentTurnImpl(ctx, scheduled[0]?.args as never, {
      signal: windowOf(10_000),
    });

    expect(spawner.attaches).toEqual(['/attach?sinceSeq=1']);
    expect(io.cancelled).toEqual([]);
    expect(scheduled).toHaveLength(1);
    expect(settled(mutations)).toHaveLength(1);
    expect(settled(mutations)[0]?.args.result).toMatchObject({
      errored: false,
      text: 'Reconciled 12 invoices.',
    });
  });

  it('settles failed exactly once when the outage outlasts its budget', async () => {
    const { ctx, mutations, scheduled } = makeCtx();
    const since = Date.now() - SPAWNER_OUTAGE_BUDGET_MS - 1;
    spawner.state = 'down';

    await driveWorkflowAgentTurnImpl(
      ctx,
      { ...KEYS, spawnerOutageSince: since },
      { signal: windowOf(300) },
    );

    expect(spawner.attaches.length).toBeGreaterThanOrEqual(1);
    expect(scheduled).toEqual([]);
    expect(io.cancelled).toEqual([KEYS.execId]);
    expect(settled(mutations)).toHaveLength(1);
    expect(settled(mutations)[0]?.args.result).toMatchObject({
      errored: true,
      failureCode: 'turn_crashed',
      reason: expect.stringContaining('could not be reached for 10 minutes'),
    });

    // A second delivery of the same window finds the turn settled.
    await driveWorkflowAgentTurnImpl(
      ctx,
      { ...KEYS, spawnerOutageSince: since },
      { signal: windowOf(300) },
    );
    expect(settled(mutations)).toHaveLength(1);
    expect(scheduled).toEqual([]);
  });
});
