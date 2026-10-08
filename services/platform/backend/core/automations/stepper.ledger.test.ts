import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Automation } from '../../../lib/engine/core/types';
import { IN_DOUBT_POLL_MS } from './liveness.ts';
import {
  fakeStepperWorld,
  ledgerKey,
  type FakeAttempt,
  type FakeWorld,
} from './stepper.test-helpers.ts';
import { stepRunImpl } from './stepper.ts';

// The catalog marks no shipped action as safe to repeat; a suite that needs
// one marks it here.
const catalog = vi.hoisted(() => ({ idempotent: new Set<string>() }));
vi.mock('../../../lib/connectors/catalog', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../lib/connectors/catalog')>();
  return {
    ...actual,
    findConnector: (...args: Parameters<typeof actual.findConnector>) => {
      const [slug] = args;
      const found = actual.findConnector(...args);
      if (found === undefined) return found;
      return {
        ...found,
        actions: found.actions.map((action) =>
          catalog.idempotent.has(`${slug}.${action.name}`)
            ? Object.assign({}, action, { idempotent: true })
            : action,
        ),
      };
    },
  };
});

// The model door, replaced: every call is recorded and answered in order.
const model = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  reply: { text: 'a fresh summary' } as Record<string, unknown>,
}));
vi.mock('./llm_call', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./llm_call')>();
  return {
    ...actual,
    automationLlmCall: () => async (request: Record<string, unknown>) => {
      model.calls.push(request);
      return model.reply;
    },
  };
});

const RUN = { organizationId: 'org-1', runId: 'run-1' } as never;

function automation(
  nodes: Automation['nodes'],
  output = '{{ nodes.send.output }}',
): Automation {
  return { version: 1, name: 'invoices', nodes, output } as Automation;
}

const SEND = {
  id: 'send',
  type: 'webdav.write',
  input: { path: '/invoices/latest.txt', content: 'due' },
};

function seed(world: FakeWorld, attempt: Partial<FakeAttempt>): FakeAttempt {
  const row: FakeAttempt = {
    id: `seeded-${attempt.nodeId ?? 'send'}-${attempt.itemIndex ?? 0}`,
    nodeId: 'send',
    itemIndex: 0,
    pass: 0,
    attempt: 1,
    kind: 'connector',
    status: 'started',
    resolution: null,
    ...attempt,
  };
  world.ledger.set(ledgerKey(row.nodeId, row.itemIndex, row.pass), row);
  return row;
}

beforeEach(() => {
  catalog.idempotent.clear();
  model.calls.length = 0;
  model.reply = { text: 'a fresh summary' };
});

describe('the stepper and the effect ledger', () => {
  it('reuses a write that finished before its checkpoint was saved, so it is sent once [AUTO-R19]', async () => {
    const world = fakeStepperWorld({
      document: automation([
        {
          ...SEND,
          input: { path: '/invoices/{{ input.number }}.txt', content: 'due' },
        },
      ]),
      input: { number: 'INV-7' },
    });
    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    expect(world.connectorCalls).toHaveLength(1);
    const firstOutput = world.finished[0]?.output;

    // The server stopped after the write and before anything else landed:
    // only the ledger row survived.
    world.run.status = 'queued';
    world.run.checkpoints = { nodes: {}, executions: 0 };
    world.finished.length = 0;

    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    expect(world.connectorCalls).toHaveLength(1);
    expect(world.finished[0]?.output).toEqual(firstOutput);
    // The step is still in the effect log, once.
    expect(world.finished[0]?.effects).toEqual([
      {
        node: 'send',
        connector: 'webdav.write',
        input: { path: '/invoices/INV-7.txt', content: 'due' },
      },
    ]);
  });

  it('parks the run for a person at a write that may already have happened, on its item [AUTO-R19]', async () => {
    const world = fakeStepperWorld({
      document: automation([
        {
          ...SEND,
          forEach: '{{ input.numbers }}',
          input: { path: '{{ item }}' },
        },
      ]),
      input: { numbers: ['a', 'b', 'c'] },
    });
    seed(world, { status: 'done', output: { sent: 'a' } });
    const open = seed(world, { itemIndex: 1 });

    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'running',
    });
    expect(world.connectorCalls).toEqual([]);
    expect(world.finished).toEqual([]);
    expect(world.suspended).toEqual([
      expect.objectContaining({
        detail: 'in_doubt:send',
        cursor: { node: 'send', index: 1, passes: 0, outs: [{ sent: 'a' }] },
        resumeInMs: IN_DOUBT_POLL_MS,
        event: {
          kind: 'in_doubt',
          detail: { path: 'send', itemIndex: 1, pass: 0, attemptId: open.id },
        },
      }),
    ]);

    // Mia checks the accounting system and chooses to send it again: only
    // that item and the ones after it are sent, each under its own key.
    open.resolution = 'retry';
    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    expect(world.connectorCalls.map((call) => call.idempotencyKey)).toEqual([
      'run-1:send:1',
      'run-1:send:2',
    ]);
    expect(world.finished[0]?.output).toEqual([
      { sent: 'a' },
      { sent: { path: 'b' } },
      { sent: { path: 'c' } },
    ]);
  });

  it('continues past a write a person skipped, as if it returned nothing [AUTO-R19]', async () => {
    const world = fakeStepperWorld({ document: automation([SEND]) });
    seed(world, { resolution: 'skip' });

    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    expect(world.connectorCalls).toEqual([]);
    expect(world.finished[0]?.output).toBeNull();
    // It may have happened, so the effect log keeps it.
    expect(world.finished[0]?.effects).toEqual([
      expect.objectContaining({ node: 'send', connector: 'webdav.write' }),
    ]);
  });

  it('fails the run at a write a person failed, whatever its onError says [AUTO-R19]', async () => {
    const world = fakeStepperWorld({
      document: automation([{ ...SEND, onError: 'continue' }]),
    });
    seed(world, { resolution: 'fail' });

    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'failed',
    });
    expect(world.connectorCalls).toEqual([]);
    expect(world.finished[0]).toMatchObject({
      status: 'failed',
      failureCode: 'effect_in_doubt',
      detail:
        'send: a person chose to fail the run here, since the step may already have run',
      // It may have happened, so the effect log keeps it.
      effects: [expect.objectContaining({ node: 'send' })],
    });
  });

  it('calls an action declared safe to repeat again, with the key its first attempt presented', async () => {
    catalog.idempotent.add('webdav.write');
    const world = fakeStepperWorld({ document: automation([SEND]) });
    seed(world, {});

    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    expect(world.begins[0]).toMatchObject({ recallable: true });
    expect(world.connectorCalls.map((call) => call.idempotencyKey)).toEqual([
      'run-1:send:0',
    ]);
    expect(world.ledger.get(ledgerKey('send', 0, 0))).toMatchObject({
      attempt: 2,
      status: 'done',
    });
  });

  it('sends no item of a resumed forEach twice', async () => {
    const world = fakeStepperWorld({
      document: automation([
        {
          ...SEND,
          forEach: '{{ input.numbers }}',
          input: { path: '{{ item }}' },
        },
      ]),
      input: { numbers: ['a', 'b', 'c'] },
    });
    seed(world, { status: 'done', output: { sent: 'a' } });
    seed(world, { itemIndex: 1, status: 'done', output: { sent: 'b' } });

    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    expect(world.connectorCalls.map((call) => call.input)).toEqual([
      { path: 'c' },
    ]);
    expect(world.finished[0]?.output).toEqual([
      { sent: 'a' },
      { sent: 'b' },
      { sent: { path: 'c' } },
    ]);
  });

  it('parks the calling node for a write inside a subautomation, addressed by its nested path [AUTO-R19]', async () => {
    const child = automation([SEND]);
    const world = fakeStepperWorld({
      document: automation(
        [
          {
            id: 'batch',
            type: 'subautomation',
            automation: 'send-invoice',
            forEach: '{{ input.numbers }}',
            input: { number: '{{ item }}' },
          },
        ],
        '{{ nodes.batch.output }}',
      ),
      input: { numbers: ['a', 'b'] },
      saved: { 'send-invoice': { versions: { 3: child }, deployed: 3 } },
    });
    seed(world, {
      nodeId: 'batch[0:0]/send',
      status: 'done',
      output: { sent: 'a' },
    });
    const open = seed(world, { nodeId: 'batch[1:0]/send' });

    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'running',
    });
    expect(world.connectorCalls).toEqual([]);
    expect(world.suspended).toEqual([
      expect.objectContaining({
        detail: 'in_doubt:batch',
        cursor: expect.objectContaining({ node: 'batch', index: 1 }),
        event: {
          kind: 'in_doubt',
          detail: {
            path: 'batch[1:0]/send',
            itemIndex: 0,
            pass: 0,
            attemptId: open.id,
          },
        },
      }),
    ]);

    open.resolution = 'retry';
    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    expect(world.connectorCalls.map((call) => call.idempotencyKey)).toEqual([
      'run-1:batch[1:0]/send:0',
    ]);
  });

  it('walks a subautomation again over the records its first walk read, so no item is skipped or sent twice [AUTO-R19]', async () => {
    // Ada's nightly batch lists the new invoices and sends each one. The
    // list's answer changes between two walks: a new invoice arrived.
    const child = automation(
      [
        { id: 'list', type: 'webdav.list', input: { path: '/invoices' } },
        {
          id: 'send',
          type: 'webdav.write',
          forEach: '{{ nodes.list.output.entries }}',
          input: { path: '{{ item }}', content: 'due' },
        },
      ],
      '{{ nodes.send.output }}',
    );
    let listed = ['A', 'B', 'C'];
    const world = fakeStepperWorld({
      document: automation(
        [{ id: 'batch', type: 'subautomation', automation: 'send-new' }],
        '{{ nodes.batch.output }}',
      ),
      saved: { 'send-new': { versions: { 2: child }, deployed: 2 } },
      connector: async (args) =>
        args.action === 'list'
          ? { status: 'ok', output: { entries: listed }, effects: 'read' }
          : { status: 'ok', output: { sent: args.input }, effects: 'write' },
    });
    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    const sentPaths = () =>
      world.connectorCalls
        .filter((call) => call.action === 'write')
        .map((call) => (call.input as { path: string }).path);
    expect(sentPaths()).toEqual(['A', 'B', 'C']);

    // The server stopped while C was being sent, before the batch node was
    // recorded: only the ledger survived, with C's send left open.
    world.run.status = 'queued';
    world.run.checkpoints = { nodes: {}, executions: 0 };
    world.finished.length = 0;
    const openSend = world.ledger.get(ledgerKey('batch[0:0]/send', 2, 0));
    if (openSend === undefined) throw new Error('no ledger row for C');
    openSend.status = 'started';
    delete openSend.output;
    listed = ['X', 'A', 'B', 'C'];

    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'running',
    });
    // The list was not asked again, and the run waits on C — the item
    // whose send may have happened — not on another one.
    expect(
      world.connectorCalls.filter((call) => call.action === 'list'),
    ).toHaveLength(1);
    expect(world.suspended.at(-1)).toMatchObject({
      detail: 'in_doubt:batch',
      event: {
        detail: {
          path: 'batch[0:0]/send',
          itemIndex: 2,
          attemptId: openSend.id,
        },
      },
    });
    expect(openSend.input).toEqual({ path: 'C', content: 'due' });

    // Ada checks the accounting system and has it send C again.
    openSend.resolution = 'retry';
    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    expect(sentPaths()).toEqual(['A', 'B', 'C', 'C']);
    expect(world.finished[0]?.output).toEqual([
      { sent: { path: 'A', content: 'due' } },
      { sent: { path: 'B', content: 'due' } },
      { sent: { path: 'C', content: 'due' } },
    ]);
  });

  it('makes a model call nobody finished again, and reuses one that finished', async () => {
    const summary = {
      id: 'summary',
      type: 'llm',
      model: 'openrouter/some-model',
      prompt: 'Summarize {{ input.text }}',
    };
    const started = fakeStepperWorld({
      document: automation([summary], '{{ nodes.summary.output }}'),
      input: { text: 'the quarter' },
    });
    seed(started, { nodeId: 'summary', kind: 'llm' });
    await expect(stepRunImpl(started.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    expect(started.begins[0]).toMatchObject({
      kind: 'llm',
      recallable: true,
      input: {
        model: 'openrouter/some-model',
        prompt: 'Summarize the quarter',
      },
    });
    expect(model.calls).toHaveLength(1);
    expect(started.finished[0]?.output).toEqual({ text: 'a fresh summary' });

    const finished = fakeStepperWorld({
      document: automation([summary], '{{ nodes.summary.output }}'),
      input: { text: 'the quarter' },
    });
    seed(finished, {
      nodeId: 'summary',
      kind: 'llm',
      status: 'done',
      output: { text: 'the summary already paid for' },
    });
    await expect(stepRunImpl(finished.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    expect(model.calls).toHaveLength(1);
    expect(finished.finished[0]?.output).toEqual({
      text: 'the summary already paid for',
    });
  });

  it('replays a recorded failure instead of calling again', async () => {
    const world = fakeStepperWorld({ document: automation([SEND]) });
    seed(world, {
      status: 'failed',
      error: 'the share refused the file',
      failureCode: 'connector_error',
    });
    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'failed',
    });
    expect(world.connectorCalls).toEqual([]);
    expect(world.finished[0]).toMatchObject({
      failureCode: 'connector_error',
      detail: 'send: the share refused the file',
    });
  });

  it('records a failed write, with its code, for a later walker to replay', async () => {
    const world = fakeStepperWorld({
      document: automation([SEND]),
      connector: async () => ({
        status: 'error',
        message: 'the share is read-only',
      }),
    });
    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'failed',
    });
    expect(world.ledger.get(ledgerKey('send', 0, 0))).toMatchObject({
      status: 'failed',
      error: 'the share is read-only',
      failureCode: 'connector_error',
    });
  });

  it('gives a repeat pass after the first its own key', async () => {
    const world = fakeStepperWorld({
      document: automation(
        [
          {
            id: 'poll',
            type: 'webdav.write',
            input: { path: '/status' },
            repeatUntil: '{{ output.sent.path === "/status" }}',
          },
        ],
        '{{ nodes.poll.output }}',
      ),
      checkpoints: {
        nodes: {},
        executions: 1,
        cursor: { node: 'poll', index: 0, passes: 1, outs: [] },
      },
    });
    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    expect(world.connectorCalls.map((call) => call.idempotencyKey)).toEqual([
      'run-1:poll:0:1',
    ]);
    expect(world.begins[0]).toMatchObject({ nodeId: 'poll', pass: 1 });
  });

  it('starts no write once another walker holds the run', async () => {
    const world = fakeStepperWorld({ document: automation([SEND]) });
    world.afterClaim = () => {
      world.run.epoch += 1;
    };
    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'cancelled',
    });
    expect(world.connectorCalls).toEqual([]);
    expect(world.finished).toEqual([]);
  });

  it('leaves reads and mock runs out of the ledger', async () => {
    const read = fakeStepperWorld({
      document: automation([
        { id: 'send', type: 'webdav.list', input: { path: '/' } },
      ]),
      connector: async () => ({ status: 'ok', output: [], effects: 'read' }),
    });
    await expect(stepRunImpl(read.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    expect(read.begins).toEqual([]);

    const mock = fakeStepperWorld({
      document: automation([SEND]),
      mode: 'mock',
    });
    await expect(stepRunImpl(mock.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    expect(mock.begins).toEqual([]);
    expect(mock.connectorCalls).toHaveLength(1);
  });
});
