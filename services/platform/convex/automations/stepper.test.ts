// @vitest-environment node

/**
 * The durable executor, driven through the REAL registered action against a
 * real Convex world.
 *
 * The properties under test are the ones that distinguish a durable run from an
 * in-memory one:
 *
 *  - a completed node is recorded before the next one starts, and a resumed
 *    turn steps over it — so an effect never happens twice;
 *  - the idempotency key a connector call carries is derived from the DURABLE
 *    run id, so even the one window that can repeat (a crash between the effect
 *    and its checkpoint) presents the vendor the same attempt;
 *  - waiting — a `repeatUntil` that has not settled, a node parked on a human —
 *    parks the run instead of holding an action open;
 *  - cancelling stops the run, and nothing after it schedules more work.
 *
 * The connector door (`connectors/execute_action`) is substituted with a
 * recording stand-in: the dispatcher's own behaviour is proven in its suite,
 * and what matters here is exactly WHAT the stepper asks it for, and how often.
 * `fetch` is stubbed to throw, so any test that did reach the network fails.
 *
 * `TALE_AUTOMATION_STEP_BUDGET_MS=0` makes the stepper hand the run back after
 * every node, which is the same code path a spent action budget takes — one
 * turn, one node, exactly the shape an interruption leaves behind.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { v } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Automation } from '../../lib/engine/core/types';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction } from '../_generated/server';
import schema from '../schema';
import { readCheckpoints } from './checkpoints';
import type { AutomationLlmRequest } from './llm_call';
import {
  setAutomationAgentHostFactory,
  setAutomationApprovalGate,
  setAutomationLlmCallFactory,
} from './stepper';
import { automationStore } from './store';

const TEST_DIR_FROM_CONVEX_ROOT = 'automations';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

/** Every connector invocation the stepper made, in order. */
interface RecordedCall {
  connector: string;
  action: string;
  mode: string;
  idempotencyKey: string;
  input: unknown;
  caller: unknown;
}
const calls: RecordedCall[] = [];

const runConnectorAction = internalAction({
  args: {
    organizationId: v.string(),
    connector: v.string(),
    action: v.string(),
    input: v.any(),
    credentialRef: v.optional(v.string()),
    mode: v.optional(v.union(v.literal('mock'), v.literal('live'))),
    caller: v.any(),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    calls.push({
      connector: args.connector,
      action: args.action,
      mode: args.mode ?? 'mock',
      idempotencyKey: args.idempotencyKey ?? '',
      input: args.input,
      caller: args.caller,
    });
    return {
      status: 'ok',
      connector: args.connector,
      action: args.action,
      nodeType: `${args.connector}.${args.action}`,
      mode: args.mode ?? 'mock',
      backend: 'mock',
      effects: 'write',
      output: { delivered: calls.length },
    };
  },
});

// Substituted AFTER the glob so it wins over the real door.
modules['connectors/execute_action.ts'] = () =>
  Promise.resolve({ runConnectorAction });

const ORG = 'org_stepper';
const ACTOR = 'user_stepper';

type T = TestConvex<typeof schema>;

beforeEach(() => {
  calls.length = 0;
  llmCalls.length = 0;
  process.env.TALE_AUTOMATION_STEP_BUDGET_MS = '0';
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('no test in this suite may reach the network');
    }),
  );
});

afterEach(() => {
  delete process.env.TALE_AUTOMATION_STEP_BUDGET_MS;
  setAutomationApprovalGate(null);
  setAutomationLlmCallFactory(null);
  setAutomationAgentHostFactory(null);
  agentKicks.length = 0;
  agentCancels.length = 0;
  vi.unstubAllGlobals();
});

/** Every llm door request the stepper made, with the org its door was built
 * for. The real door reaches the network, which this suite forbids, so the
 * factory seam gets this recording stand-in instead. */
const llmCalls: Array<{
  organizationId: string;
  request: AutomationLlmRequest;
}> = [];

function recordingLlmFactory() {
  setAutomationLlmCallFactory((_ctx, organizationId) => (request) => {
    llmCalls.push({ organizationId, request });
    return Promise.resolve(
      request.outputSchema === undefined
        ? { text: 'one real sentence' }
        : { data: { score: 7 } },
    );
  });
}

/** Save + deploy one document, the way the authoring surface would. */
async function publish(t: T, wf: Automation): Promise<void> {
  await t.run(async (ctx) => {
    const store = automationStore(ctx, {
      organizationId: ORG,
      actor: ACTOR,
    });
    const saved = await store.save(wf);
    await store.deploy(saved.name, saved.version);
  });
}

/**
 * Create a run row WITHOUT scheduling anything, so the test drives the turns
 * itself and can look at the row between them.
 */
async function queueRun(
  t: T,
  name: string,
  input: unknown,
  mode: 'mock' | 'live' = 'live',
): Promise<Id<'automationRuns'>> {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert('automationRuns', {
        organizationId: ORG,
        name,
        version: 1,
        status: 'queued',
        mode,
        startedBy: `user:${ACTOR}`,
        input,
        checkpoints: { nodes: {}, executions: 0 },
        startedAt: Date.now(),
      }),
  );
}

async function turn(t: T, runId: Id<'automationRuns'>): Promise<string> {
  const result = await t.action(internal.automations.stepper.stepRun, {
    organizationId: ORG,
    runId,
  });
  return result.status;
}

async function runRow(t: T, runId: Id<'automationRuns'>) {
  const row = await t.run(async (ctx) => await ctx.db.get(runId));
  if (!row) throw new Error('run row disappeared');
  return row;
}

/**
 * Turn the run until it settles. Standing in for the scheduler: a `waiting` run
 * is one the scheduler would come back to, so the loop continues through it.
 */
async function drive(
  t: T,
  runId: Id<'automationRuns'>,
  maxTurns = 20,
): Promise<string> {
  for (let i = 0; i < maxTurns; i++) {
    await turn(t, runId);
    const row = await runRow(t, runId);
    if (
      row.status !== 'running' &&
      row.status !== 'queued' &&
      row.status !== 'waiting'
    ) {
      return row.status;
    }
  }
  throw new Error('run did not settle');
}

const notifyThenSummarize: Automation = {
  version: 1,
  name: 'ops/notify',
  nodes: [
    {
      id: 'send',
      type: 'demo.send_message',
      input: { to: '{{ input.who }}', text: 'hello' },
    },
    {
      id: 'summarize',
      type: 'transform',
      input: { sent: '{{ nodes.send.output }}' },
      code: 'return { summary: "delivered #" + input.sent.delivered }',
    },
  ],
  output: '{{ nodes.summarize.output }}',
};

describe('durable stepper — checkpoints and resume', () => {
  it('records each node before the next one starts', async () => {
    const t = convexTest(schema, modules);
    await publish(t, notifyThenSummarize);
    const runId = await queueRun(t, 'ops/notify', { who: 'ops@example.com' });

    // Budget 0: one node per turn, which is what a spent action window does.
    await turn(t, runId);
    const afterFirst = await runRow(t, runId);
    expect(afterFirst.status).toBe('running');
    const first = readCheckpoints(afterFirst.checkpoints);
    expect(Object.keys(first.nodes)).toEqual(['send']);
    expect(first.nodes.send.output).toEqual({ delivered: 1 });
    expect(calls).toHaveLength(1);

    await turn(t, runId);
    const done = await runRow(t, runId);
    expect(done.status).toBe('success');
    expect(done.output).toEqual({ summary: 'delivered #1' });
    expect(done.trace).toHaveLength(2);
    expect(done.effects).toEqual([
      {
        node: 'send',
        connector: 'demo.send_message',
        input: { to: 'ops@example.com', text: 'hello' },
      },
    ]);
  });

  it('resumes from the checkpoint and does not re-execute a completed effectful node', async () => {
    const t = convexTest(schema, modules);
    await publish(t, notifyThenSummarize);
    const runId = await queueRun(t, 'ops/notify', { who: 'ops@example.com' });

    // Turn one sends the message and records it.
    await turn(t, runId);
    expect(calls).toHaveLength(1);

    // Simulate the interruption: the row is left at `running` with the
    // checkpoint written and no continuation in flight — exactly what an action
    // killed mid-run leaves behind. Re-entering must NOT send again.
    for (let i = 0; i < 3; i++) await turn(t, runId);

    const connectorCalls = calls.filter(
      (call) => call.connector === 'demo' && call.action === 'send_message',
    );
    expect(connectorCalls).toHaveLength(1);

    const row = await runRow(t, runId);
    expect(row.status).toBe('success');
    expect(row.output).toEqual({ summary: 'delivered #1' });
  });

  it('carries a retry-stable idempotency key derived from the durable run id', async () => {
    const t = convexTest(schema, modules);
    await publish(t, notifyThenSummarize);
    const runId = await queueRun(t, 'ops/notify', { who: 'ops@example.com' });
    await drive(t, runId);

    expect(calls[0].idempotencyKey).toBe(`${runId}:send:0`);
    expect(calls[0].caller).toEqual({
      kind: 'workflow',
      runId,
      nodeId: 'send',
    });

    // A second run of the same automation is a different attempt, so its key
    // differs — the stability is per run, not per document.
    const secondRunId = await queueRun(t, 'ops/notify', { who: 'x@e.com' });
    await drive(t, secondRunId);
    expect(calls[1].idempotencyKey).toBe(`${secondRunId}:send:0`);
    expect(calls[0].idempotencyKey).not.toBe(calls[1].idempotencyKey);
  });

  it('resumes a forEach mid-array without re-sending the items already sent', async () => {
    const t = convexTest(schema, modules);
    await publish(t, {
      version: 1,
      name: 'ops/fanout',
      nodes: [
        {
          id: 'send',
          type: 'demo.send_message',
          forEach: '{{ input.people }}',
          input: { to: '{{ item }}', text: 'hi' },
        },
      ],
      output: '{{ nodes.send.output }}',
    });
    const runId = await queueRun(t, 'ops/fanout', {
      people: ['a@e.com', 'b@e.com', 'c@e.com'],
    });

    // With a spent budget the stepper stops between items, leaving a cursor.
    await turn(t, runId);
    const mid = await runRow(t, runId);
    const cursor = readCheckpoints(mid.checkpoints).cursor;
    expect(cursor).toMatchObject({ node: 'send', index: 1 });
    expect(calls).toHaveLength(1);

    await drive(t, runId);
    const recipients = calls.map((call) => (call.input as { to: string }).to);
    // Each recipient exactly once, in order, across three turns.
    expect(recipients).toEqual(['a@e.com', 'b@e.com', 'c@e.com']);
    // Per-item keys keep their index, so a retried item is the same attempt.
    expect(calls.map((call) => call.idempotencyKey)).toEqual([
      `${runId}:send:0`,
      `${runId}:send:1`,
      `${runId}:send:2`,
    ]);
    const done = await runRow(t, runId);
    expect(done.status).toBe('success');
    expect(done.output).toEqual([
      { delivered: 1 },
      { delivered: 2 },
      { delivered: 3 },
    ]);
  });

  it('keeps branch decisions across a resume', async () => {
    const t = convexTest(schema, modules);
    await publish(t, {
      version: 1,
      name: 'ops/branch',
      nodes: [
        {
          id: 'urgent',
          type: 'transform',
          when: '{{ input.priority === "high" }}',
          code: 'return { path: "urgent" }',
        },
        {
          id: 'normal',
          type: 'transform',
          elseOf: 'urgent',
          code: 'return { path: "normal" }',
        },
        {
          id: 'notify',
          type: 'transform',
          input: { urgent: '{{ nodes.urgent.output }}' },
          code: 'return { notified: input.urgent.path }',
        },
      ],
      output: {
        urgent: '{{ nodes.urgent.output }}',
        normal: '{{ nodes.normal.output }}',
      },
    });
    const runId = await queueRun(t, 'ops/branch', { priority: 'low' }, 'mock');
    await drive(t, runId);

    const row = await runRow(t, runId);
    const checkpoints = readCheckpoints(row.checkpoints);
    // `urgent` was skipped by its own condition, so the else-branch ran and the
    // node reading `urgent` skipped — the reasons survive being reconstructed
    // from the row rather than from memory.
    expect(checkpoints.nodes.urgent).toMatchObject({
      status: 'skipped',
      reason: 'when',
    });
    expect(checkpoints.nodes.normal).toMatchObject({ status: 'ok' });
    expect(checkpoints.nodes.notify).toMatchObject({
      status: 'skipped',
      reason: 'upstream',
    });
    expect(row.status).toBe('success');
    expect(row.output).toEqual({ urgent: null, normal: { path: 'normal' } });
  });
});

describe('durable stepper — waiting', () => {
  it('parks between repeatUntil passes instead of holding the action open', async () => {
    const t = convexTest(schema, modules);
    // A poll: ask the connector until it reports the third delivery. The
    // stand-in counts calls, so each pass genuinely advances.
    await publish(t, {
      version: 1,
      name: 'ops/poll',
      nodes: [
        {
          id: 'poll',
          type: 'demo.check_status',
          repeatUntil: '{{ output.delivered >= 3 }}',
          maxRepeats: 5,
          input: { job: '{{ input.job }}' },
        },
      ],
      output: '{{ nodes.poll.output }}',
    });
    const runId = await queueRun(t, 'ops/poll', { job: 'j-1' }, 'mock');

    await turn(t, runId);
    const parked = await runRow(t, runId);
    expect(parked.status).toBe('waiting');
    expect(parked.detail).toBe('repeat:poll');
    expect(readCheckpoints(parked.checkpoints).cursor).toMatchObject({
      node: 'poll',
      passes: 1,
    });
    // Nothing is recorded yet: the node has not settled.
    expect(readCheckpoints(parked.checkpoints).nodes).toEqual({});
    expect(calls).toHaveLength(1);

    const status = await drive(t, runId);
    expect(status).toBe('success');
    const done = await runRow(t, runId);
    expect(done.output).toEqual({ delivered: 3 });
    // Every pass is the same logical attempt, so they carry one key — the
    // executor's own rule, kept across the suspensions between them.
    expect(calls.map((call) => call.idempotencyKey)).toEqual([
      `${runId}:poll:0`,
      `${runId}:poll:0`,
      `${runId}:poll:0`,
    ]);
  });

  it('parks a live effectful node on the real approvals gate and resumes once granted', async () => {
    const t = convexTest(schema, modules);
    // A shipped WRITE connector, so the real gate installed by `stepRun`
    // resolves its effect from the catalog and holds it for a human.
    await publish(t, {
      version: 1,
      name: 'ops/file-issue',
      nodes: [
        {
          id: 'file',
          type: 'github.create_issue',
          input: { owner: 'tale', repo: 'tale', title: '{{ input.title }}' },
        },
      ],
      output: '{{ nodes.file.output }}',
    });
    const runId = await queueRun(t, 'ops/file-issue', { title: 'Ship it' });

    // First turn: the write is held. Nothing reached the connector door.
    await turn(t, runId);
    const parked = await runRow(t, runId);
    expect(parked.status).toBe('waiting');
    expect(calls).toHaveLength(0);

    const approval = await t.run(async (ctx) => {
      for await (const row of ctx.db
        .query('approvals')
        .withIndex('by_resource', (q) =>
          q
            .eq('resourceType', 'connector_operation')
            .eq('resourceId', `${runId}:file`),
        )) {
        return row;
      }
      return null;
    });
    if (!approval) throw new Error('expected a pending approval for the node');
    expect(parked.detail).toBe(`approval:${approval._id}`);
    expect(approval.metadata).toMatchObject({
      source: 'automation',
      runId,
      nodeId: 'file',
      automation: 'ops/file-issue',
    });

    // A human approves — the resolution mutation moves the row to `executing`.
    await t.run(async (ctx) => {
      await ctx.db.patch(approval._id, { status: 'executing' });
    });

    const status = await drive(t, runId);
    expect(status).toBe('success');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      connector: 'github',
      action: 'create_issue',
      mode: 'live',
    });
    // The approval was consumed, so it leaves the active-approvals view.
    const resolved = await t.run(async (ctx) => await ctx.db.get(approval._id));
    expect(resolved?.status).toBe('completed');
  });

  it('does not gate a live READ node — a read changes nothing', async () => {
    const t = convexTest(schema, modules);
    // `tavily.search` is a shipped READ connector action.
    await publish(t, {
      version: 1,
      name: 'ops/lookup',
      nodes: [
        {
          id: 'search',
          type: 'tavily.search',
          input: { query: '{{ input.q }}' },
        },
      ],
      output: '{{ nodes.search.output }}',
    });
    const runId = await queueRun(t, 'ops/lookup', { q: 'rag' });
    expect(await drive(t, runId)).toBe('success');
    // It ran without ever parking on an approval.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ connector: 'tavily', action: 'search' });
    const approvals = await t.run(async (ctx) =>
      ctx.db.query('approvals').collect(),
    );
    expect(approvals).toHaveLength(0);
  });
});

describe('durable stepper — cancellation and failure', () => {
  it('stops a cancelled run and performs no further work', async () => {
    const t = convexTest(schema, modules);
    await publish(t, notifyThenSummarize);
    const runId = await queueRun(t, 'ops/notify', { who: 'ops@example.com' });

    await turn(t, runId);
    expect(calls).toHaveLength(1);

    await t.run(async (ctx) => {
      await ctx.db.patch(runId, {
        status: 'cancelled',
        detail: 'cancelled by an operator',
        finishedAt: Date.now(),
      });
    });

    // A continuation that arrives after the cancellation must do nothing.
    expect(await turn(t, runId)).toBe('cancelled');
    const row = await runRow(t, runId);
    expect(row.status).toBe('cancelled');
    expect(row.output).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('fails the run at the node that threw, and does not step over it', async () => {
    const t = convexTest(schema, modules);
    await publish(t, {
      version: 1,
      name: 'ops/broken',
      nodes: [
        { id: 'first', type: 'transform', code: 'return { ok: true }' },
        { id: 'boom', type: 'transform', code: 'throw new Error("nope")' },
        {
          id: 'after',
          type: 'transform',
          input: { from: '{{ nodes.boom.output }}' },
          code: 'return input',
        },
      ],
    });
    const runId = await queueRun(t, 'ops/broken', {}, 'mock');
    const status = await drive(t, runId);

    expect(status).toBe('failed');
    const row = await runRow(t, runId);
    expect(row.detail).toContain('boom:');
    const checkpoints = readCheckpoints(row.checkpoints);
    // The failing node is deliberately NOT checkpointed — a recovery sweep must
    // not treat it as handled — while the node before it is.
    expect(Object.keys(checkpoints.nodes)).toEqual(['first']);
    const trace = row.trace as Array<{ node: string; status: string }>;
    expect(trace.map((entry) => [entry.node, entry.status])).toEqual([
      ['first', 'ok'],
      ['boom', 'error'],
      ['after', 'not_run'],
    ]);
  });

  it('continues past a node marked onError: continue and skips its dependents', async () => {
    const t = convexTest(schema, modules);
    await publish(t, {
      version: 1,
      name: 'ops/tolerant',
      nodes: [
        {
          id: 'flaky',
          type: 'transform',
          onError: 'continue',
          code: 'throw new Error("nope")',
        },
        {
          id: 'reader',
          type: 'transform',
          input: { from: '{{ nodes.flaky.output }}' },
          code: 'return input',
        },
        { id: 'other', type: 'transform', code: 'return { fine: true }' },
      ],
      output: '{{ nodes.other.output }}',
    });
    const runId = await queueRun(t, 'ops/tolerant', {}, 'mock');
    expect(await drive(t, runId)).toBe('success');

    const checkpoints = readCheckpoints((await runRow(t, runId)).checkpoints);
    expect(checkpoints.nodes.flaky).toMatchObject({
      status: 'skipped',
      reason: 'error',
    });
    expect(checkpoints.nodes.reader).toMatchObject({
      status: 'skipped',
      reason: 'upstream',
    });
    expect(checkpoints.nodes.other).toMatchObject({ status: 'ok' });
  });
});

describe('durable stepper — modes', () => {
  it('asks the connector door for the run mode, and a mock run reaches nothing', async () => {
    const t = convexTest(schema, modules);
    await publish(t, notifyThenSummarize);

    const mockRun = await queueRun(t, 'ops/notify', { who: 'a@e.com' }, 'mock');
    expect(await drive(t, mockRun)).toBe('success');
    expect(calls.map((call) => call.mode)).toEqual(['mock']);

    const liveRun = await queueRun(t, 'ops/notify', { who: 'a@e.com' }, 'live');
    expect(await drive(t, liveRun)).toBe('success');
    expect(calls.map((call) => call.mode)).toEqual(['mock', 'live']);
    // `fetch` is stubbed to throw for the whole suite: nothing here touched it.
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('schedules its own continuation, and stops scheduling once cancelled', async () => {
    const t = convexTest(schema, modules);
    await publish(t, notifyThenSummarize);
    const runId = await queueRun(t, 'ops/notify', { who: 'ops@example.com' });

    // A turn that hands off leaves exactly one pending continuation — that is
    // what carries the run across the action boundary.
    await turn(t, runId);
    const pending = await t.run(
      async (ctx) =>
        await ctx.db.system.query('_scheduled_functions').collect(),
    );
    expect(
      pending.filter(
        (job) => job.name.includes('stepper') && job.state.kind === 'pending',
      ),
    ).toHaveLength(1);

    await t.run(async (ctx) => {
      await ctx.db.patch(runId, {
        status: 'cancelled',
        finishedAt: Date.now(),
      });
    });
    await turn(t, runId);
    const afterCancel = await t.run(
      async (ctx) =>
        await ctx.db.system.query('_scheduled_functions').collect(),
    );
    // No new continuation was added for a run nobody is going to finish.
    expect(
      afterCancel.filter(
        (job) => job.name.includes('stepper') && job.state.kind === 'pending',
      ),
    ).toHaveLength(1);
  });
});

const summarizeSubject: Automation = {
  version: 1,
  name: 'ops/summarize',
  nodes: [
    {
      id: 'summary',
      type: 'llm',
      model: 'vendor/small-1',
      system: 'Be terse.',
      prompt: 'Summarize: {{ input.subject }}',
    },
  ],
  output: '{{ nodes.summary.output.text }}',
};

const scoreSubject: Automation = {
  version: 1,
  name: 'ops/score',
  nodes: [
    {
      id: 'score',
      type: 'llm',
      model: 'vendor/small-1',
      prompt: 'Score: {{ input.subject }}',
      outputSchema: {
        type: 'object',
        properties: { score: { type: 'number' } },
        required: ['score'],
      },
    },
  ],
  output: '{{ nodes.score.output }}',
};

describe('durable stepper — llm nodes', () => {
  it('sends a live llm node through the run door, built for the run organization', async () => {
    recordingLlmFactory();
    const t = convexTest(schema, modules);
    await publish(t, summarizeSubject);
    const runId = await queueRun(t, 'ops/summarize', { subject: 'hello' });

    expect(await drive(t, runId)).toBe('success');
    expect(llmCalls).toEqual([
      {
        organizationId: ORG,
        request: {
          model: 'vendor/small-1',
          prompt: 'Summarize: hello',
          system: 'Be terse.',
        },
      },
    ]);

    const row = await runRow(t, runId);
    expect(row.output).toBe('one real sentence');
    expect(row.effects).toEqual([
      {
        node: 'summary',
        connector: 'llm',
        input: {
          model: 'vendor/small-1',
          prompt: 'Summarize: hello',
          system: 'Be terse.',
        },
      },
    ]);
  });

  it('hands an outputSchema node the door reply as data', async () => {
    recordingLlmFactory();
    const t = convexTest(schema, modules);
    await publish(t, scoreSubject);
    const runId = await queueRun(t, 'ops/score', { subject: 'hello' });

    expect(await drive(t, runId)).toBe('success');
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0].request.outputSchema).toEqual(
      scoreSubject.nodes[0].outputSchema,
    );

    const row = await runRow(t, runId);
    expect(row.output).toEqual({ score: 7 });
  });

  it('never opens the door for a mock run — the deterministic mock answers', async () => {
    recordingLlmFactory();
    const t = convexTest(schema, modules);
    await publish(t, summarizeSubject);
    const runId = await queueRun(t, 'ops/summarize', { subject: 'x' }, 'mock');

    expect(await drive(t, runId)).toBe('success');
    expect(llmCalls).toHaveLength(0);
    const row = await runRow(t, runId);
    expect(row.output).toMatch(/^MOCK_LLM_RESPONSE\[vendor\/small-1:/);
  });
});

const readInvoices: Automation = {
  version: 1,
  name: 'ops/read-invoices',
  nodes: [
    {
      id: 'extract',
      type: 'agent',
      model: 'vendor/coder-1',
      prompt: 'Read invoices for {{ input.quarter }}',
      skills: ['document-verify'],
      files: { input: '{{ input.folderId }}' },
    },
  ],
  output: '{{ nodes.extract.output }}',
};

/** The same read, with the model pick pinned to its serving provider. */
const readInvoicesPinned: Automation = {
  version: 1,
  name: 'ops/read-invoices-pinned',
  nodes: [
    {
      id: 'extract',
      type: 'agent',
      model: 'vendor/coder-1',
      modelProvider: 'vendor',
      prompt: 'Read invoices for {{ input.quarter }}',
    },
  ],
  output: '{{ nodes.extract.output }}',
};

/** Every kick/cancel the stepper asked the agent door for. */
const agentKicks: Array<{
  runId: string;
  nodeId: string;
  request: unknown;
  excludeBrokerTokenHashes?: string[];
}> = [];
const agentCancels: Array<{ sessionId: string; execId: string }> = [];

/** A recording agent host: kicks park under sequential exec ids (`exec-1`,
 * `exec-2`, … — a retry's re-kick is a fresh exec), polls see nothing (the
 * settle writes straight into the cursor, which the next turn reads),
 * cancels record. */
function recordingAgentFactory(kick?: () => never): void {
  setAutomationAgentHostFactory((_ctx, _organizationId) => ({
    kick: async ({ runId, nodeId, request, excludeBrokerTokenHashes }) => {
      if (kick !== undefined) kick();
      const execId = `exec-${agentKicks.length + 1}`;
      agentKicks.push({
        runId,
        nodeId,
        request,
        ...(excludeBrokerTokenHashes !== undefined
          ? { excludeBrokerTokenHashes }
          : {}),
      });
      return {
        execId,
        sessionId: 'wf-session-1',
        deadlineAt: Date.now() + 60_000,
        providerSlug: 'vendor',
        gatewayModel: 'vendor/coder-1',
        harness: 'claude-code',
      };
    },
    poll: async () => null,
    cancel: async ({ sessionId, execId }) => {
      agentCancels.push({ sessionId, execId });
    },
  }));
}

describe('durable stepper — agent nodes', () => {
  it('answers a mock run with the deterministic envelope and records the effect', async () => {
    const t = convexTest(schema, modules);
    await publish(t, readInvoices);
    const runId = await queueRun(
      t,
      'ops/read-invoices',
      { quarter: '2026Q1', folderId: 'fld_1' },
      'mock',
    );

    expect(await drive(t, runId)).toBe('success');
    const row = await runRow(t, runId);
    expect(row.output).toMatchObject({
      files: [],
      status: 'ok',
    });
    expect((row.output as { text: string }).text).toMatch(
      /^MOCK_AGENT_RESPONSE\[vendor\/coder-1:/,
    );
    expect(row.effects).toEqual([
      {
        node: 'extract',
        connector: 'agent',
        input: {
          model: 'vendor/coder-1',
          prompt: 'Read invoices for 2026Q1',
          skills: ['document-verify'],
          files: { input: 'fld_1' },
        },
      },
    ]);
    // Mock mode never consults the host.
    expect(agentKicks).toHaveLength(0);
  });

  it('carries the node model-provider pin into the kick request', async () => {
    recordingAgentFactory();
    const t = convexTest(schema, modules);
    await publish(t, readInvoicesPinned);
    const runId = await queueRun(t, 'ops/read-invoices-pinned', {
      quarter: '2026Q1',
    });

    await turn(t, runId);
    expect(agentKicks[0]?.request).toMatchObject({
      model: 'vendor/coder-1',
      modelProvider: 'vendor',
    });

    // Settle the parked turn so the test leaves no scheduled work behind.
    await t.mutation(internal.automations.mutations.recordAgentTurnSettled, {
      organizationId: ORG,
      runId,
      nodeId: 'extract',
      execId: 'exec-1',
      result: { errored: false, text: 'done', files: [], status: 'ok' },
    });
    expect(await drive(t, runId)).toBe('success');
  });

  it('kicks a live turn once, parks the run, and consumes the settled envelope', async () => {
    recordingAgentFactory();
    const t = convexTest(schema, modules);
    await publish(t, readInvoices);
    const runId = await queueRun(t, 'ops/read-invoices', {
      quarter: '2026Q1',
      folderId: 'fld_1',
    });

    // Turn 1: the kick parks the run with the in-flight turn in the cursor.
    await turn(t, runId);
    const parked = await runRow(t, runId);
    expect(parked.status).toBe('waiting');
    expect(parked.detail).toBe('agent:extract');
    const cursor = readCheckpoints(parked.checkpoints).cursor;
    expect(cursor?.node).toBe('extract');
    expect(cursor?.agent).toMatchObject({
      execId: 'exec-1',
      sessionId: 'wf-session-1',
    });
    expect(agentKicks).toEqual([
      {
        runId,
        nodeId: 'extract',
        request: {
          model: 'vendor/coder-1',
          prompt: 'Read invoices for 2026Q1',
          skills: ['document-verify'],
          files: { input: 'fld_1' },
        },
      },
    ]);

    // A poll turn before the settle keeps the run parked, without re-kicking.
    await turn(t, runId);
    expect((await runRow(t, runId)).status).toBe('waiting');
    expect(agentKicks).toHaveLength(1);

    // The agent host settles: result into the cursor, stepper poked.
    const recorded = await t.mutation(
      internal.automations.mutations.recordAgentTurnSettled,
      {
        organizationId: ORG,
        runId,
        nodeId: 'extract',
        execId: 'exec-1',
        result: {
          errored: false,
          text: 'extracted 2 invoices',
          files: [
            {
              name: 'a.ocr.json',
              storageId: 'st_1',
              size: 128,
              contentType: 'application/json',
            },
          ],
          status: 'ok',
        },
      },
    );
    expect(recorded).toEqual({ recorded: true });

    expect(await drive(t, runId)).toBe('success');
    const row = await runRow(t, runId);
    expect(row.output).toEqual({
      text: 'extracted 2 invoices',
      files: [
        {
          name: 'a.ocr.json',
          storageId: 'st_1',
          size: 128,
          contentType: 'application/json',
        },
      ],
      status: 'ok',
    });
    expect(row.effects).toEqual([
      {
        node: 'extract',
        connector: 'agent',
        input: {
          model: 'vendor/coder-1',
          prompt: 'Read invoices for 2026Q1',
          skills: ['document-verify'],
          files: { input: 'fld_1' },
        },
      },
    ]);
    expect(agentKicks).toHaveLength(1);
  });

  it('fails the node cleanly when the kick refuses', async () => {
    recordingAgentFactory(() => {
      throw new Error(
        'no configured provider serves model "vendor/coder-1" — an llm node\'s model must be listed in a connected provider\'s catalog',
      );
    });
    const t = convexTest(schema, modules);
    await publish(t, readInvoices);
    const runId = await queueRun(t, 'ops/read-invoices', {
      quarter: '2026Q1',
      folderId: 'fld_1',
    });

    expect(await drive(t, runId)).toBe('failed');
    const row = await runRow(t, runId);
    expect(row.detail).toContain('no configured provider serves model');
    const trace = row.trace as Array<{ node: string; status: string }>;
    expect(trace.map((entry) => [entry.node, entry.status])).toEqual([
      ['extract', 'error'],
    ]);
  });

  it('a denylisted errored settle fails the node with its reason, no retry', async () => {
    recordingAgentFactory();
    const t = convexTest(schema, modules);
    await publish(t, readInvoices);
    const runId = await queueRun(t, 'ops/read-invoices', {
      quarter: '2026Q1',
      folderId: 'fld_1',
    });

    await turn(t, runId);
    await t.mutation(internal.automations.mutations.recordAgentTurnSettled, {
      organizationId: ORG,
      runId,
      nodeId: 'extract',
      execId: 'exec-1',
      result: {
        errored: true,
        reason: 'the agent turn ran past its time limit and was stopped',
        failureCode: 'deadline',
        text: '',
        files: [],
      },
    });

    expect(await drive(t, runId)).toBe('failed');
    const row = await runRow(t, runId);
    expect(row.detail).toContain('ran past its time limit');
    expect(row.detail).not.toContain('attempts');
    expect(agentKicks).toHaveLength(1);
  });

  it('a stale settle records nothing and resurrects nothing', async () => {
    recordingAgentFactory();
    const t = convexTest(schema, modules);
    await publish(t, readInvoices);
    const runId = await queueRun(t, 'ops/read-invoices', {
      quarter: '2026Q1',
      folderId: 'fld_1',
    });
    await turn(t, runId);

    const recorded = await t.mutation(
      internal.automations.mutations.recordAgentTurnSettled,
      {
        organizationId: ORG,
        runId,
        nodeId: 'extract',
        execId: 'exec-STALE',
        result: { errored: false, text: 'x', files: [] },
      },
    );
    expect(recorded).toEqual({ recorded: false });
    expect((await runRow(t, runId)).status).toBe('waiting');
  });
});

describe('durable stepper — agent auto-retry', () => {
  /** Settle the given exec as a retryable failure (no code = default-retry). */
  async function settleErrored(
    t: T,
    runId: Id<'automationRuns'>,
    execId: string,
    result: Record<string, unknown> = {},
  ) {
    return await t.mutation(
      internal.automations.mutations.recordAgentTurnSettled,
      {
        organizationId: ORG,
        runId,
        nodeId: 'extract',
        execId,
        result: {
          errored: true,
          reason: 'the agent turn could not start: fetch failed',
          failureCode: 'start_failed',
          text: '',
          files: [],
          ...result,
        },
      },
    );
  }

  async function agentCursor(t: T, runId: Id<'automationRuns'>) {
    const cursor = readCheckpoints((await runRow(t, runId)).checkpoints).cursor;
    if (cursor?.agent === undefined) throw new Error('no parked agent cursor');
    return cursor.agent;
  }

  it('re-kicks a retryable failure in place and consumes the retry settle', async () => {
    recordingAgentFactory();
    const t = convexTest(schema, modules);
    await publish(t, readInvoices);
    const runId = await queueRun(t, 'ops/read-invoices', {
      quarter: '2026Q1',
      folderId: 'fld_1',
    });

    await turn(t, runId);
    await settleErrored(t, runId, 'exec-1');
    await turn(t, runId);

    // Parked again on a fresh exec, run alive, attempt counted.
    const parked = await runRow(t, runId);
    expect(parked.status).toBe('waiting');
    expect(parked.detail).toBe('agent:extract');
    expect(await agentCursor(t, runId)).toMatchObject({
      execId: 'exec-2',
      attempt: 1,
    });
    expect(agentKicks).toHaveLength(2);
    // The retry re-kicks the SAME resolved request — no template re-eval.
    expect(agentKicks[1]?.request).toEqual(agentKicks[0]?.request);

    await t.mutation(internal.automations.mutations.recordAgentTurnSettled, {
      organizationId: ORG,
      runId,
      nodeId: 'extract',
      execId: 'exec-2',
      result: { errored: false, text: 'extracted', files: [], status: 'ok' },
    });
    expect(await drive(t, runId)).toBe('success');
    const row = await runRow(t, runId);
    expect(row.output).toMatchObject({ text: 'extracted' });
    // Exactly one agent effect lands — the consuming turn's.
    expect(
      (row.effects as Array<{ connector: string }>).filter(
        (effect) => effect.connector === 'agent',
      ),
    ).toHaveLength(1);
  });

  it('exhausts the budget after three retries and records the attempt count', async () => {
    recordingAgentFactory();
    const t = convexTest(schema, modules);
    await publish(t, readInvoices);
    const runId = await queueRun(t, 'ops/read-invoices', {
      quarter: '2026Q1',
      folderId: 'fld_1',
    });

    await turn(t, runId);
    for (const execId of ['exec-1', 'exec-2', 'exec-3']) {
      await settleErrored(t, runId, execId);
      await turn(t, runId);
      expect((await runRow(t, runId)).status).toBe('waiting');
    }
    expect(await agentCursor(t, runId)).toMatchObject({
      execId: 'exec-4',
      attempt: 3,
    });
    await settleErrored(t, runId, 'exec-4');

    expect(await drive(t, runId)).toBe('failed');
    const row = await runRow(t, runId);
    expect(row.detail).toContain('fetch failed');
    expect(row.detail).toContain('(after 4 attempts)');
    // The budget is spent — no fifth kick.
    expect(agentKicks).toHaveLength(4);
  });

  it('a settle without a failure code retries by default', async () => {
    recordingAgentFactory();
    const t = convexTest(schema, modules);
    await publish(t, readInvoices);
    const runId = await queueRun(t, 'ops/read-invoices', {
      quarter: '2026Q1',
      folderId: 'fld_1',
    });

    await turn(t, runId);
    // No reason, no code — the pre-classification settle shape.
    await t.mutation(internal.automations.mutations.recordAgentTurnSettled, {
      organizationId: ORG,
      runId,
      nodeId: 'extract',
      execId: 'exec-1',
      result: {
        errored: true,
        text: 'API Error: Request rejected (429)',
        files: [],
      },
    });
    await turn(t, runId);

    expect((await runRow(t, runId)).status).toBe('waiting');
    expect(agentKicks).toHaveLength(2);
  });

  it('an expired ask never retries — a fresh turn would only re-ask', async () => {
    recordingAgentFactory();
    const t = convexTest(schema, modules);
    await publish(t, readInvoices);
    const runId = await queueRun(t, 'ops/read-invoices', {
      quarter: '2026Q1',
      folderId: 'fld_1',
    });

    await turn(t, runId);
    await settleErrored(t, runId, 'exec-1', {
      reason:
        'the agent asked the operator a question and nobody answered within 7 days',
      failureCode: 'ask_expired',
    });

    expect(await drive(t, runId)).toBe('failed');
    expect((await runRow(t, runId)).detail).toContain('nobody answered');
    expect(agentKicks).toHaveLength(1);
  });

  it('an attempt that executed past the progress threshold refreshes the budget and keeps burned hashes', async () => {
    recordingAgentFactory();
    const t = convexTest(schema, modules);
    await publish(t, readInvoices);
    const runId = await queueRun(t, 'ops/read-invoices', {
      quarter: '2026Q1',
      folderId: 'fld_1',
    });

    await turn(t, runId);
    await settleErrored(t, runId, 'exec-1');
    await turn(t, runId);
    await settleErrored(t, runId, 'exec-2');
    await turn(t, runId);
    expect(await agentCursor(t, runId)).toMatchObject({
      execId: 'exec-3',
      attempt: 2,
    });

    // Attempt 2 launches, runs past the progress threshold on a broker
    // account, then fails: the counter resets, the burned account does not.
    const stamped = await t.mutation(
      internal.automations.mutations.stampAgentTurnLaunch,
      {
        organizationId: ORG,
        runId,
        nodeId: 'extract',
        execId: 'exec-3',
        launchedAt: Date.now() - 16 * 60_000,
        brokerTokenHash: 'hash-b',
      },
    );
    expect(stamped).toEqual({ stamped: true });
    await settleErrored(t, runId, 'exec-3');
    await turn(t, runId);

    expect(await agentCursor(t, runId)).toMatchObject({
      execId: 'exec-4',
      attempt: 1,
      burnedBrokerTokenHashes: ['hash-b'],
    });
    expect(agentKicks[3]?.excludeBrokerTokenHashes).toEqual(['hash-b']);
  });

  it("rotation: the re-kick excludes the settled attempt's broker account", async () => {
    recordingAgentFactory();
    const t = convexTest(schema, modules);
    await publish(t, readInvoices);
    const runId = await queueRun(t, 'ops/read-invoices', {
      quarter: '2026Q1',
      folderId: 'fld_1',
    });

    await turn(t, runId);
    await t.mutation(internal.automations.mutations.stampAgentTurnLaunch, {
      organizationId: ORG,
      runId,
      nodeId: 'extract',
      execId: 'exec-1',
      launchedAt: Date.now(),
      brokerTokenHash: 'hash-a',
    });
    await settleErrored(t, runId, 'exec-1');
    await turn(t, runId);

    expect(agentKicks[1]?.excludeBrokerTokenHashes).toEqual(['hash-a']);
    expect(await agentCursor(t, runId)).toMatchObject({
      execId: 'exec-2',
      burnedBrokerTokenHashes: ['hash-a'],
    });
    // The first kick carried no exclusions.
    expect(agentKicks[0]?.excludeBrokerTokenHashes).toBeUndefined();
  });

  it('a resume that dies before the retarget settles under the asking exec and the retry rescues the run', async () => {
    recordingAgentFactory();
    const t = convexTest(schema, modules);
    await publish(t, readInvoices);
    const input = {
      model: 'vendor/coder-1',
      prompt: 'Read invoices for 2026Q1',
    };
    // A run parked on an answered ask: the cursor still names the asking
    // exec, whose op was finalized (claim burned) when the ask parked.
    const runId = await t.run(
      async (ctx) =>
        await ctx.db.insert('automationRuns', {
          organizationId: ORG,
          name: 'ops/read-invoices',
          version: 1,
          status: 'waiting',
          mode: 'live',
          startedBy: `user:${ACTOR}`,
          input: { quarter: '2026Q1', folderId: 'fld_1' },
          checkpoints: {
            nodes: {},
            cursor: {
              node: 'extract',
              index: 0,
              passes: 0,
              outs: [],
              agent: {
                execId: 'ask-exec-1',
                sessionId: 'wf-test-session',
                deadlineAt: Date.now() + 7 * 24 * 3_600_000,
                providerSlug: 'vendor',
                gatewayModel: 'vendor/coder-1',
                harness: 'claude-code',
                input,
              },
            },
            executions: 1,
          },
          startedAt: Date.now(),
        }),
    );
    const askId = await t.run(
      async (ctx) =>
        await ctx.db.insert('automationHumanAsks', {
          organizationId: ORG,
          runId,
          nodeId: 'extract',
          sessionId: 'wf-test-session',
          execId: 'ask-exec-1',
          question: 'Which quarter?',
          status: 'answered',
          answer: '2026Q1',
          expiresAt: Date.now() + 7 * 24 * 3_600_000,
          createdAt: Date.now(),
        }),
    );
    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      organizationId: ORG,
      sessionId: 'wf-test-session',
      execId: 'ask-exec-1',
      kind: 'workflow-agent',
      status: 'completed',
      agentResultStatus: 'awaiting_human',
    });
    await t.mutation(
      internal.sandbox.session_mutations.claimSessionOpFinalize,
      {
        sessionId: 'wf-test-session',
        execId: 'ask-exec-1',
      },
    );

    // The REAL resume action: the suite's fetch stub kills it long before the
    // retarget (session ensure / serving / mint all reach the network), so
    // the catch must settle under the ASKING exec the cursor still names.
    await t.action(
      internal.automations.agent_host.resumeWorkflowAgentTurnWithAnswer,
      { organizationId: ORG, askId },
    );

    const settled = await agentCursor(t, runId);
    expect(settled.execId).toBe('ask-exec-1');
    expect(settled.result).toMatchObject({
      errored: true,
      failureCode: 'resume_failed',
    });
    expect(settled.result?.reason).toContain(
      'could not resume after the answer',
    );

    // The settle wakes the run into the retry gate: a fresh attempt kicks,
    // and its success finishes the run — the answered ask no longer strands
    // it until the ask-extended deadline.
    await turn(t, runId);
    expect(agentKicks).toHaveLength(1);
    expect(agentKicks[0]?.request).toEqual(input);
    expect(await agentCursor(t, runId)).toMatchObject({
      execId: 'exec-1',
      attempt: 1,
    });
    await t.mutation(internal.automations.mutations.recordAgentTurnSettled, {
      organizationId: ORG,
      runId,
      nodeId: 'extract',
      execId: 'exec-1',
      result: { errored: false, text: 'extracted', files: [], status: 'ok' },
    });
    expect(await drive(t, runId)).toBe('success');
  });

  it('a stale settle from the replaced exec records nothing after the re-kick', async () => {
    recordingAgentFactory();
    const t = convexTest(schema, modules);
    await publish(t, readInvoices);
    const runId = await queueRun(t, 'ops/read-invoices', {
      quarter: '2026Q1',
      folderId: 'fld_1',
    });

    await turn(t, runId);
    await settleErrored(t, runId, 'exec-1');
    await turn(t, runId);

    // The dead attempt's chain settles late — refused, the retry unharmed.
    const stale = await settleErrored(t, runId, 'exec-1');
    expect(stale).toEqual({ recorded: false });
    const launch = await t.mutation(
      internal.automations.mutations.stampAgentTurnLaunch,
      {
        organizationId: ORG,
        runId,
        nodeId: 'extract',
        execId: 'exec-1',
        launchedAt: Date.now(),
      },
    );
    expect(launch).toEqual({ stamped: false });
    const cursor = await agentCursor(t, runId);
    expect(cursor.execId).toBe('exec-2');
    expect(cursor.launchedAt).toBeUndefined();
  });
});

describe('run liveness under lost wakes', () => {
  /**
   * The incident class: a parked agent turn settles, then EVERY scheduled
   * wake of the run dies (a deploy swapping the node bundle mid-flight killed
   * both the 30s poll tick and the settle's poke — scheduled actions are
   * at-most-once, so neither ever retries). In this suite the pending jobs
   * are simply never driven, which is exactly what a lost action looks like
   * from the row's point of view. The liveness sweep must find the overdue
   * promise and re-poke; the re-poked turn must consume the settled result.
   */
  it('recovers a settled-but-unconsumed run after every scheduled wake is lost', async () => {
    recordingAgentFactory();
    const t = convexTest(schema, modules);
    await publish(t, readInvoices);
    const runId = await queueRun(t, 'ops/read-invoices', {
      quarter: '2026Q1',
      folderId: 'fld_1',
    });

    await turn(t, runId);
    expect((await runRow(t, runId)).status).toBe('waiting');

    await t.mutation(internal.automations.mutations.recordAgentTurnSettled, {
      organizationId: ORG,
      runId,
      nodeId: 'extract',
      execId: 'exec-1',
      result: { errored: false, text: 'extracted', files: [], status: 'ok' },
    });

    // The settle stamped the promise due-now; within the grace window the
    // sweep stays quiet (the poke would normally land any moment).
    const quiet = await t.mutation(
      internal.automations.triggers.enforceRunLiveness,
      {},
    );
    expect(quiet).toEqual({ poked: 0 });

    // Grace elapses with no wake — the jobs are dead. The sweep pokes.
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { wakeAt: Date.now() - 2 * 60_000 });
    });
    const swept = await t.mutation(
      internal.automations.triggers.enforceRunLiveness,
      {},
    );
    expect(swept).toEqual({ poked: 1 });

    // The poked turn (here driven directly, as the scheduled job would)
    // consumes the settled result and completes the run — no re-kick.
    expect(await drive(t, runId)).toBe('success');
    expect((await runRow(t, runId)).output).toMatchObject({
      text: 'extracted',
      status: 'ok',
    });
    expect(agentKicks).toHaveLength(1);
  });

  it('a superseded walker cannot resurrect or double-drive the run', async () => {
    const t = convexTest(schema, modules);
    await publish(t, notifyThenSummarize);
    const runId = await queueRun(t, 'ops/notify', { who: 'ops@example.com' });

    // Walker A claims, then stalls; the sweep-poked walker B claims after it
    // and finishes the run as failed.
    const claimA = await t.mutation(internal.automations.mutations.claimRun, {
      organizationId: ORG,
      runId,
    });
    const claimB = await t.mutation(internal.automations.mutations.claimRun, {
      organizationId: ORG,
      runId,
    });
    expect(claimB.epoch).toBe(claimA.epoch + 1);
    await t.mutation(internal.automations.mutations.finishRun, {
      organizationId: ORG,
      runId,
      epoch: claimB.epoch,
      status: 'failed',
      trace: [],
      effects: [],
      detail: 'node exploded',
      executions: 1,
    });
    expect((await runRow(t, runId)).status).toBe('failed');

    // A wakes up and tries to park / progress / finish with its stale epoch:
    // every write is refused and the run stays exactly as B left it.
    const suspended = await t.mutation(
      internal.automations.mutations.suspendRun,
      {
        organizationId: ORG,
        runId,
        epoch: claimA.epoch,
        detail: 'agent:ghost',
        executions: 1,
        resumeInMs: 30_000,
      },
    );
    expect(suspended).toEqual({ suspended: false });
    const progressed = await t.mutation(
      internal.automations.mutations.recordProgress,
      {
        organizationId: ORG,
        runId,
        epoch: claimA.epoch,
        executions: 1,
      },
    );
    expect(progressed.status).toBe('failed');
    const finished = await t.mutation(
      internal.automations.mutations.finishRun,
      {
        organizationId: ORG,
        runId,
        epoch: claimA.epoch,
        status: 'success',
        trace: [],
        effects: [],
        executions: 1,
      },
    );
    expect(finished).toEqual({ status: 'failed' });
    const row = await runRow(t, runId);
    expect(row.status).toBe('failed');
    expect(row.detail).toBe('node exploded');
  });

  it('heartbeats renew the promise only for the live epoch — a slow node never reads as dead', async () => {
    const t = convexTest(schema, modules);
    await publish(t, notifyThenSummarize);
    const runId = await queueRun(t, 'ops/notify', { who: 'ops@example.com' });
    const claim = await t.mutation(internal.automations.mutations.claimRun, {
      organizationId: ORG,
      runId,
    });

    // However stale the promise got, a live walker's heartbeat renews it and
    // the sweep leaves the run alone — a model taking half an hour per call
    // is slow, not dead.
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { wakeAt: Date.now() - 10 * 60_000 });
    });
    const beat = await t.mutation(internal.automations.mutations.heartbeatRun, {
      organizationId: ORG,
      runId,
      epoch: claim.epoch,
    });
    expect(beat).toEqual({ alive: true });
    expect((await runRow(t, runId)).wakeAt).toBeGreaterThan(Date.now());
    expect(
      await t.mutation(internal.automations.triggers.enforceRunLiveness, {}),
    ).toEqual({ poked: 0 });

    // A superseded walker's heartbeat is refused and renews nothing.
    await t.mutation(internal.automations.mutations.claimRun, {
      organizationId: ORG,
      runId,
    });
    const staleBeat = await t.mutation(
      internal.automations.mutations.heartbeatRun,
      { organizationId: ORG, runId, epoch: claim.epoch },
    );
    expect(staleBeat).toEqual({ alive: false });
  });
});

describe('the poll chain — mutation hops', () => {
  const pendingByName = async (t: T, needle: string) =>
    await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query('_scheduled_functions').collect();
      return jobs.filter(
        (job) => job.name.includes(needle) && job.state.kind === 'pending',
      );
    });

  /** Park a live agent run and return its row facts. */
  async function parkAgentRun(t: T) {
    recordingAgentFactory();
    await publish(t, readInvoices);
    const runId = await queueRun(t, 'ops/read-invoices', {
      quarter: '2026Q1',
      folderId: 'fld_1',
    });
    await turn(t, runId);
    const row = await runRow(t, runId);
    expect(row.status).toBe('waiting');
    return { runId, seq: row.chainSeq ?? 0 };
  }

  it('an unsettled agent park re-arms quietly — no stepper turn, promise renewed', async () => {
    const t = convexTest(schema, modules);
    const { runId, seq } = await parkAgentRun(t);
    const stepsBefore = (await pendingByName(t, 'stepper')).length;

    const hop = await t.mutation(internal.automations.mutations.pollParkedRun, {
      organizationId: ORG,
      runId,
      seq,
      pollMs: 30_000,
    });
    expect(hop).toEqual({ due: false, rearmed: true });
    const row = await runRow(t, runId);
    expect(row.status).toBe('waiting');
    expect(row.wakeAt).toBeGreaterThan(Date.now());
    // However slow the agent's model is, a quiet park never costs a node
    // action — only the next hop was scheduled.
    expect(await pendingByName(t, 'stepper')).toHaveLength(stepsBefore);
    expect((await pendingByName(t, 'pollParkedRun')).length).toBeGreaterThan(0);
  });

  it('a settled agent park is due: the hop wakes the stepper', async () => {
    const t = convexTest(schema, modules);
    const { runId, seq } = await parkAgentRun(t);
    await t.mutation(internal.automations.mutations.recordAgentTurnSettled, {
      organizationId: ORG,
      runId,
      nodeId: 'extract',
      execId: 'exec-1',
      result: { errored: false, text: 'done', files: [], status: 'ok' },
    });
    const stepsBefore = (await pendingByName(t, 'stepper')).length;

    const hop = await t.mutation(internal.automations.mutations.pollParkedRun, {
      organizationId: ORG,
      runId,
      seq,
      pollMs: 30_000,
    });
    expect(hop).toEqual({ due: true, rearmed: false });
    expect((await pendingByName(t, 'stepper')).length).toBe(stepsBefore + 1);
    expect(await drive(t, runId)).toBe('success');
  });

  it('a superseded hop stops dead — one live chain per park', async () => {
    const t = convexTest(schema, modules);
    const { runId, seq } = await parkAgentRun(t);
    // A newer park bumped the seq (simulated directly): the old hop must
    // neither step nor re-arm, whatever the run is doing.
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { chainSeq: seq + 1 });
    });
    const stepsBefore = (await pendingByName(t, 'stepper')).length;
    const hopsBefore = (await pendingByName(t, 'pollParkedRun')).length;

    const hop = await t.mutation(internal.automations.mutations.pollParkedRun, {
      organizationId: ORG,
      runId,
      seq,
      pollMs: 30_000,
    });
    expect(hop).toEqual({ due: false, rearmed: false });
    expect((await pendingByName(t, 'stepper')).length).toBe(stepsBefore);
    expect((await pendingByName(t, 'pollParkedRun')).length).toBe(hopsBefore);
  });

  it('an agent park past its deadline is due even unsettled', async () => {
    const t = convexTest(schema, modules);
    const { runId, seq } = await parkAgentRun(t);
    // Push the parked turn's deadline into the past.
    await t.run(async (ctx) => {
      const row = await ctx.db.get(runId);
      const checkpoints = readCheckpoints(row?.checkpoints);
      const cursor = checkpoints.cursor;
      if (!cursor?.agent) throw new Error('expected an agent cursor');
      await ctx.db.patch(runId, {
        checkpoints: {
          ...checkpoints,
          cursor: {
            ...cursor,
            agent: { ...cursor.agent, deadlineAt: Date.now() - 1 },
          },
        },
      });
    });

    const hop = await t.mutation(internal.automations.mutations.pollParkedRun, {
      organizationId: ORG,
      runId,
      seq,
      pollMs: 30_000,
    });
    expect(hop).toEqual({ due: true, rearmed: false });
    // The stepper turn enforces the deadline through its existing branch:
    // cancel the exec, fail the node with the real reason.
    expect(await drive(t, runId)).toBe('failed');
    expect((await runRow(t, runId)).detail).toContain('time limit');
    expect(agentCancels).toEqual([
      { sessionId: 'wf-session-1', execId: 'exec-1' },
    ]);
  });

  it('an approval park stays quiet while pending, and wakes on the decision', async () => {
    const t = convexTest(schema, modules);
    await publish(t, notifyThenSummarize);
    const runId = await queueRun(t, 'ops/notify', { who: 'ops@example.com' });
    const approvalId = await t.run(
      async (ctx) =>
        await ctx.db.insert('approvals', {
          organizationId: ORG,
          status: 'pending',
          resourceType: 'connector_operation',
          resourceId: `${runId}:send`,
          priority: 'medium',
          metadata: { source: 'automation', requestedAt: Date.now() },
        }),
    );
    // Park the run behind that approval the way the gate would.
    const claim = await t.mutation(internal.automations.mutations.claimRun, {
      organizationId: ORG,
      runId,
    });
    await t.mutation(internal.automations.mutations.suspendRun, {
      organizationId: ORG,
      runId,
      epoch: claim.epoch,
      detail: `approval:${approvalId}`,
      executions: 1,
      resumeInMs: 30_000,
    });
    const seq = (await runRow(t, runId)).chainSeq ?? 0;
    const stepsBefore = (await pendingByName(t, 'stepper')).length;

    const pendingHop = await t.mutation(
      internal.automations.mutations.pollParkedRun,
      { organizationId: ORG, runId, seq, pollMs: 30_000 },
    );
    expect(pendingHop).toEqual({ due: false, rearmed: true });
    expect((await pendingByName(t, 'stepper')).length).toBe(stepsBefore);

    await t.run(async (ctx) => {
      await ctx.db.patch(approvalId, { status: 'executing' });
    });
    const decidedHop = await t.mutation(
      internal.automations.mutations.pollParkedRun,
      { organizationId: ORG, runId, seq, pollMs: 30_000 },
    );
    expect(decidedHop).toEqual({ due: true, rearmed: false });
    expect((await pendingByName(t, 'stepper')).length).toBe(stepsBefore + 1);
  });
});
