// @vitest-environment node

import { beforeAll, describe, expect, it } from 'vitest';

import { nodeVmRunner } from '../../runners/node-vm';
import { memoryStore } from '../../selftest/memory-store';
import { reasonFamily } from '../record/failure';
import { createRecorder } from '../record/recorder';
import type { StepFailure } from '../record/types';
import {
  type ConnectorScenario,
  registerNodeType,
  setCodeRunner,
} from '../slots';
import type { Automation, Json, NodeDef, RunBench, RunResult } from '../types';
import { execute } from './index';

/** Called by the `ping.send` mock on every call, so a test can act in the
 * middle of a run. */
let onPing: (() => void) | undefined;

/** What the live body of `sheet.read` throws: the error a live call raises
 * when the service refuses it. */
let liveError = new Error('no live failure was set');

const TWO_ROWS: ConnectorScenario = {
  name: 'two_rows',
  kind: 'success',
  description: 'The sheet has two rows.',
  output: { rows: [{ n: 1 }, { n: 2 }] },
};

/** The scenarios `sheet.read` ships: answers for every call or for the Q3
 * sheet only, and the errors a live call raises, with their statuses. */
const SHEET_SCENARIOS: ConnectorScenario[] = [
  TWO_ROWS,
  {
    name: 'q3_rows',
    kind: 'success',
    description: 'The Q3 sheet has one row.',
    when: { sheet: 'Q3' },
    output: { rows: [{ n: 3 }] },
  },
  {
    name: 'q3_locked',
    kind: 'error',
    description: 'Someone else holds the Q3 sheet.',
    when: { sheet: 'Q3' },
    error: { message: 'the sheet is locked' },
  },
  {
    name: 'rate_limited',
    kind: 'error',
    description: 'The service refuses: too many requests.',
    error: { message: 'too many requests', status: 429 },
  },
  {
    name: 'token_revoked',
    kind: 'error',
    description: 'The service refuses the credential.',
    error: { message: 'the token was revoked', status: 401 },
  },
  {
    name: 'no_access',
    kind: 'error',
    description: 'The credential may not read this sheet.',
    error: { message: 'no access to this sheet', status: 403 },
  },
  {
    name: 'no_such_sheet',
    kind: 'error',
    description: 'No sheet has this name.',
    error: { message: 'no such sheet', status: 404 },
  },
  {
    name: 'server_down',
    kind: 'error',
    description: 'The service fails on its side.',
    error: { message: 'the service is down', status: 503 },
  },
  {
    name: 'offline',
    kind: 'error',
    description: 'The service cannot be reached.',
    error: { message: 'fetch failed' },
  },
  {
    name: 'garbled',
    kind: 'error',
    description: 'The service answers what the action cannot read.',
    error: { message: 'the service answered garbage' },
  },
];

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
  registerNodeType({
    type: 'mail.send',
    kind: 'connector',
    outputKind: 'structured',
    description: 'test connector: send a mail (a write)',
    allowedFields: ['input'],
    requiredFields: ['input'],
    connector: {
      name: 'mail.send',
      description: 'send a mail',
      inputSchema: {
        type: 'object',
        properties: { to: { type: 'string' }, body: { type: 'string' } },
        required: ['to'],
        additionalProperties: false,
      },
      outputSignature: '{ id: string }',
      hasEffect: true,
      mock: () => ({ id: 'mock-mail' }),
    },
  });
  registerNodeType({
    type: 'inbox.list',
    kind: 'connector',
    outputKind: 'structured',
    description: 'test connector: list waiting conversations (a read)',
    allowedFields: ['input'],
    requiredFields: ['input'],
    connector: {
      name: 'inbox.list',
      description: 'list conversations',
      inputSchema: { type: 'object' },
      outputSignature: '{ conversations: Array<{ id: string }> }',
      hasEffect: false,
      mock: () => ({ conversations: [{ id: 'c1', from: 'ada@example.test' }] }),
    },
  });
  registerNodeType({
    type: 'ping.send',
    kind: 'connector',
    outputKind: 'structured',
    description: 'test connector: a write that reports each call',
    allowedFields: ['input'],
    requiredFields: ['input'],
    connector: {
      name: 'ping.send',
      description: 'send a ping',
      inputSchema: { type: 'object' },
      outputSignature: '{ ok: boolean }',
      hasEffect: true,
      mock: () => {
        onPing?.();
        return { ok: true };
      },
    },
  });
  registerNodeType({
    type: 'sheet.read',
    kind: 'connector',
    outputKind: 'structured',
    description: 'test connector: read a sheet (a read that ships scenarios)',
    allowedFields: ['input'],
    requiredFields: ['input'],
    connector: {
      name: 'sheet.read',
      description: 'read a sheet',
      inputSchema: {
        type: 'object',
        properties: { sheet: { type: 'string' } },
        required: ['sheet'],
        additionalProperties: false,
      },
      outputSignature: '{ rows: Array<{ n: number }> }',
      hasEffect: false,
      display: { connector: 'sheet' },
      mock: () => ({ rows: [], answered: 'mock' }),
      live: () => Promise.reject(liveError),
      scenarios: SHEET_SCENARIOS,
    },
  });
  registerNodeType({
    type: 'sheet.append',
    kind: 'connector',
    outputKind: 'structured',
    description: 'test connector: append a row (a write that ships scenarios)',
    allowedFields: ['input'],
    requiredFields: ['input'],
    connector: {
      name: 'sheet.append',
      description: 'append a row',
      inputSchema: { type: 'object' },
      outputSignature: '{ row: number }',
      hasEffect: true,
      mock: () => ({ row: 1 }),
      scenarios: [
        {
          name: 'appended',
          kind: 'success',
          description: 'The row is appended as the seventh.',
          output: { row: 7 },
        },
        {
          name: 'protected',
          kind: 'refusal',
          description: 'The sheet is protected.',
          error: { message: 'the sheet is protected', status: 403 },
        },
      ],
    },
  });
});

function doc(nodes: NodeDef[], extra: Partial<Automation> = {}): Automation {
  return { version: 1, name: 'bench-probe', nodes, ...extra };
}

/** inbox (a read) → pick (code) → reply (a write) that answers the first
 * conversation's sender. */
const TRIAGE = doc(
  [
    { id: 'inbox', type: 'inbox.list', input: {} },
    {
      id: 'pick',
      type: 'transform',
      input: { list: '{{ nodes.inbox.output.conversations }}' },
      code: 'return { to: input.list[0].from, count: input.list.length };',
    },
    {
      id: 'reply',
      type: 'mail.send',
      when: '{{ nodes.pick.output.count > 0 }}',
      input: { to: '{{ nodes.pick.output.to }}', body: 'Thanks!' },
    },
  ],
  {
    output: {
      count: '{{ nodes.pick.output.count }}',
      sent: '{{ nodes.reply.output }}',
    },
  },
);

const run = (d: Automation, bench: RunBench, input: unknown = {}) =>
  execute(d, { input, mode: 'mock', bench });

describe('a test replaces only the calls it names; everything else runs as written [AUTO-R42]', () => {
  it('a stand-in replaces the answer: the input is still resolved and the effect recorded', async () => {
    const result = await run(TRIAGE, {
      mocks: {
        inbox: { conversations: [{ id: 'c9', from: 'grace@example.test' }] },
        reply: { id: 'simulated' },
      },
    });
    expect(result.status).toBe('success');
    // The code between the two stand-ins ran as written, on the stand-in.
    expect(result.trace.find((e) => e.node === 'pick')).toMatchObject({
      status: 'ok',
      output: { to: 'grace@example.test', count: 1 },
    });
    expect(result.trace.find((e) => e.node === 'pick')?.bench).toBeUndefined();
    expect(result.trace.find((e) => e.node === 'reply')).toMatchObject({
      status: 'ok',
      bench: 'mocked',
      input: { to: 'grace@example.test', body: 'Thanks!' },
      output: { id: 'simulated' },
    });
    expect(result.effects).toEqual([
      {
        node: 'reply',
        connector: 'mail.send',
        input: { to: 'grace@example.test', body: 'Thanks!' },
      },
    ]);
    expect(result.output).toEqual({ count: 1, sent: { id: 'simulated' } });
    expect(result.unusedMocks).toBeUndefined();
  });

  it('the skip rules apply to a node that has a stand-in, which then goes unused', async () => {
    const result = await run(TRIAGE, {
      mocks: { inbox: { conversations: [] }, reply: { id: 'never' } },
    });
    // count is 0: the code reads list[0].from of an empty list and fails —
    // so the test proves what the real empty inbox would do.
    expect(result.status).toBe('error');
    expect(result.error?.nodeId).toBe('pick');

    const guarded = doc(
      [
        { id: 'inbox', type: 'inbox.list', input: {} },
        {
          id: 'reply',
          type: 'mail.send',
          when: '{{ nodes.inbox.output.conversations.length > 0 }}',
          input: { to: 'ada@example.test' },
        },
        {
          id: 'log',
          type: 'transform',
          input: { sent: '{{ nodes.reply.output }}' },
          code: 'return input.sent;',
        },
      ],
      { output: '{{ nodes.reply.output }}' },
    );
    const skipped = await run(guarded, {
      mocks: { inbox: { conversations: [] }, reply: { id: 'never' } },
    });
    expect(skipped.status).toBe('success');
    expect(skipped.trace.map((e) => [e.node, e.status])).toEqual([
      ['inbox', 'ok'],
      ['reply', 'skipped'],
      ['log', 'skipped'],
    ]);
    expect(skipped.effects).toEqual([]);
    expect(skipped.unusedMocks).toEqual(['reply']);
  });

  it('a stand-in still meets its connector’s input schema', async () => {
    const d = doc([
      { id: 'reply', type: 'mail.send', input: { to: '{{ 42 }}' } },
    ]);
    const result = await run(d, { mocks: { reply: { id: 'simulated' } } });
    expect(result.status).toBe('error');
    expect(result.error?.failure?.reason).toBe('CONNECTOR_INPUT_REFUSED');
    expect(result.effects).toEqual([]);
  });

  it('a simulated failure fails the node once its input is resolved; onError applies', async () => {
    const halting = await run(TRIAGE, {
      failures: { reply: 'the mailbox is full' },
    });
    expect(halting.status).toBe('error');
    expect(halting.error).toMatchObject({
      nodeId: 'reply',
      message: 'the mailbox is full (simulated by the test)',
      failure: {
        code: 'node_error',
        reason: 'SIMULATED_FAILURE',
        params: { message: 'the mailbox is full' },
      },
    });
    expect(halting.trace.find((e) => e.node === 'reply')).toMatchObject({
      status: 'error',
      bench: 'failed',
      input: { to: 'ada@example.test', body: 'Thanks!' },
    });
    // A failed call sent nothing.
    expect(halting.effects).toEqual([]);

    const tolerant = doc(
      [
        { id: 'ping', type: 'ping.send', input: {}, onError: 'continue' },
        {
          id: 'after',
          type: 'transform',
          input: { ok: '{{ nodes.ping.output.ok }}' },
          code: 'return input.ok;',
        },
        { id: 'other', type: 'transform', code: 'return "ran";' },
      ],
      { output: '{{ nodes.other.output }}' },
    );
    const goesOn = await run(tolerant, { failures: { ping: '' } });
    expect(goesOn.status).toBe('success');
    expect(goesOn.trace.map((e) => [e.node, e.status])).toEqual([
      ['ping', 'error'],
      ['after', 'skipped'],
      ['other', 'ok'],
    ]);
    expect(goesOn.trace[0]?.error).toBe('a failure simulated by the test');
  });

  it('a stand-in replaces a model’s answer and the code of a transform', async () => {
    const d = doc(
      [
        {
          id: 'shape',
          type: 'transform',
          code: 'throw new Error("never runs");',
        },
        {
          id: 'ask',
          type: 'llm',
          model: 'test-model',
          prompt: 'Rate {{ nodes.shape.output.n }}',
        },
      ],
      { output: '{{ nodes.ask.output.text }}' },
    );
    const result = await run(d, {
      mocks: { shape: { n: 3 }, ask: { text: 'five stars' } },
    });
    expect(result.status).toBe('success');
    expect(result.output).toBe('five stars');
    expect(result.effects).toEqual([
      {
        node: 'ask',
        connector: 'llm',
        input: { model: 'test-model', prompt: 'Rate 3' },
      },
    ]);
  });

  it('a stand-in replaces a whole called automation, which is not even looked up', async () => {
    const d = doc(
      [
        {
          id: 'child',
          type: 'subautomation',
          automation: 'billing/notify',
          input: { who: 'Ada' },
        },
      ],
      { output: '{{ nodes.child.output }}' },
    );
    const result = await run(d, { mocks: { child: { notified: true } } });
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ notified: true });
    expect(result.effects).toEqual([]);
    expect(result.trace[0]).toMatchObject({
      bench: 'mocked',
      input: { automation: 'billing/notify', input: { who: 'Ada' } },
    });
  });

  it('a forEach stand-in is a list: item i returns entry i, and each item’s effect is recorded', async () => {
    const d = doc(
      [
        {
          id: 'each',
          type: 'mail.send',
          forEach: '{{ input.to }}',
          input: { to: '{{ item }}' },
        },
      ],
      { output: '{{ nodes.each.output }}' },
    );
    const input = { to: ['a@example.test', 'b@example.test'] };
    const result = await run(
      d,
      { mocks: { each: [{ id: 'one' }, { id: 'two' }, { id: 'spare' }] } },
      input,
    );
    expect(result.status).toBe('success');
    expect(result.output).toEqual([{ id: 'one' }, { id: 'two' }]);
    expect(result.effects).toEqual([
      {
        node: 'each',
        connector: 'mail.send',
        input: { to: 'a@example.test' },
        item: 0,
      },
      {
        node: 'each',
        connector: 'mail.send',
        input: { to: 'b@example.test' },
        item: 1,
      },
    ]);

    const short = await run(d, { mocks: { each: [{ id: 'one' }] } }, input);
    expect(short.error?.message).toBe(
      'the test\'s simulated output for "each" has 1 entry, but forEach gave 2 items',
    );
    const notAList = await run(d, { mocks: { each: { id: 'x' } } }, input);
    expect(notAList.error?.message).toBe(
      'the test\'s simulated output for "each" is an object, but "each" runs once per item (forEach) — it needs a list',
    );
  });

  it('a node that runs per item over no items never uses its stand-in', async () => {
    const d = doc(
      [
        {
          id: 'each',
          type: 'ping.send',
          forEach: '{{ input.items }}',
          input: {},
        },
      ],
      { output: '{{ nodes.each.output }}' },
    );
    for (const bench of [
      { failures: { each: 'down' } },
      { mocks: { each: [] } },
    ] satisfies RunBench[]) {
      const result = await execute(d, {
        input: { items: [] },
        mode: 'mock',
        bench,
        recorder: createRecorder({ now: () => Date.now() }),
      });
      expect(result.status).toBe('success');
      expect(result.output).toEqual([]);
      // Nothing stood in for a call that was never made.
      expect(result.trace[0]?.bench).toBeUndefined();
      expect(
        result.record?.find((r) => r.key.path === 'each' && r.key.item < 0)
          ?.meta.bench,
      ).toBeUndefined();
      expect(result.unusedMocks).toEqual(['each']);
    }
  });

  it('a repeating node returns its stand-in on every pass, judged as written', async () => {
    const d = (until: string) =>
      doc(
        [
          {
            id: 'poll',
            type: 'ping.send',
            input: {},
            repeatUntil: until,
            maxRepeats: 3,
          },
        ],
        { output: '{{ nodes.poll.output }}' },
      );
    const never = await run(d('{{ output.done }}'), {
      mocks: { poll: { done: false } },
    });
    expect(never.status).toBe('success');
    expect(never.effects).toHaveLength(3);
    expect(never.trace[0]?.note).toBe(
      'repeatUntil ran 3x (maxRepeats hit before the condition became true)',
    );
    const once = await run(d('{{ output.done }}'), {
      mocks: { poll: { done: true } },
    });
    expect(once.effects).toHaveLength(1);
  });

  it('a bench for nodes the automation does not have is refused before anything runs', async () => {
    const result = await run(TRIAGE, { mocks: { inbx: {} } });
    expect(result).toMatchObject({
      status: 'invalid',
      trace: [],
      effects: [],
      validation: {
        errors: [
          {
            code: 'BENCH_UNKNOWN_NODE',
            at: { pointer: '/bench/mocks/inbx', subject: 'key' },
            params: { field: 'mocks', node: 'inbx', suggestion: 'inbox' },
          },
        ],
        warnings: [],
      },
    });
  });

  it('a live run refuses a bench', async () => {
    const result = await execute(TRIAGE, {
      mode: 'live',
      bench: { mocks: { inbox: {} } },
    });
    expect(result.status).toBe('invalid');
    expect(result.validation?.errors[0]).toMatchObject({
      code: 'BENCH_MOCK_ONLY',
      message:
        'simulated outputs, simulated failures, picked scenarios and narrower scopes apply to mock runs only',
      at: { pointer: '/bench' },
    });
  });
});

describe('step tests', () => {
  const FLOW = doc(
    [
      { id: 'inbox', type: 'inbox.list', input: {} },
      {
        id: 'pick',
        type: 'transform',
        input: { list: '{{ nodes.inbox.output.conversations }}' },
        code: 'return { to: input.list[0].from, count: input.list.length };',
      },
      {
        id: 'reply',
        type: 'mail.send',
        when: '{{ nodes.pick.output.count > 5 }}',
        input: { to: '{{ nodes.pick.output.to }}' },
      },
      {
        id: 'quiet',
        type: 'transform',
        elseOf: 'reply',
        code: 'return "nothing to answer";',
      },
    ],
    // Evaluated, this output fails: a step test never evaluates it.
    { output: '{{ nodes.quiet.output.missing.field }}' },
  );

  it('up to a node: it and what it needs run as written, the rest is left out', async () => {
    const result = await run(FLOW, { upTo: 'pick' });
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ to: 'ada@example.test', count: 1 });
    expect(result.focus).toEqual({ node: 'pick', kind: 'upTo' });
    expect(result.trace.map((e) => [e.node, e.status, e.bench])).toEqual([
      ['inbox', 'ok', undefined],
      ['pick', 'ok', undefined],
      ['reply', 'not_run', 'left-out'],
      ['quiet', 'not_run', 'left-out'],
    ]);
  });

  it('one node alone runs on pinned data, whatever its condition says', async () => {
    const result = await run(FLOW, {
      only: 'reply',
      mocks: { pick: { to: 'zoe@example.test', count: 1 }, inbox: { x: 1 } },
    });
    expect(result.status).toBe('success');
    expect(result.focus).toEqual({ node: 'reply', kind: 'only' });
    expect(result.output).toEqual({ id: 'mock-mail' });
    expect(result.trace.map((e) => [e.node, e.status, e.bench])).toEqual([
      ['inbox', 'not_run', 'left-out'],
      ['pick', 'ok', 'pinned'],
      ['reply', 'ok', undefined],
      ['quiet', 'not_run', 'left-out'],
    ]);
    // count 1 is not > 5: it would have been skipped, and ran anyway.
    expect(result.trace[2]?.whenWouldSkip).toBe(true);
    expect(result.effects).toEqual([
      {
        node: 'reply',
        connector: 'mail.send',
        input: { to: 'zoe@example.test' },
      },
    ]);
    // The pin for a node it does not read went unused.
    expect(result.unusedMocks).toEqual(['inbox']);
  });

  it('a node run alone ignores its alternative’s partner', async () => {
    const result = await run(FLOW, { only: 'quiet' });
    expect(result.status).toBe('success');
    expect(result.output).toBe('nothing to answer');
  });

  it('one node alone without the data it reads is refused', async () => {
    const result = await run(FLOW, { only: 'reply' });
    expect(result.status).toBe('invalid');
    expect(result.validation?.errors[0]).toMatchObject({
      code: 'BENCH_PINS_MISSING',
      at: { pointer: '/bench/only' },
      params: { node: 'reply', missing: ['pick'] },
    });
  });

  it('one item of a node that runs per item', async () => {
    const d = doc([
      { id: 'list', type: 'transform', code: 'return ["a", "b", "c"];' },
      {
        id: 'shout',
        type: 'transform',
        forEach: '{{ nodes.list.output }}',
        input: { word: '{{ item }}' },
        code: 'return input.word.toUpperCase();',
      },
    ]);
    const one = await run(d, {
      only: 'shout',
      item: 1,
      mocks: { list: ['x', 'y', 'z'] },
    });
    expect(one.status).toBe('success');
    expect(one.output).toBe('Y');
    expect(one.focus).toEqual({ node: 'shout', kind: 'only', item: 1 });
    const past = await run(d, {
      only: 'shout',
      item: 5,
      mocks: { list: ['x'] },
    });
    expect(past).toMatchObject({
      status: 'invalid',
      validation: {
        errors: [
          {
            code: 'BENCH_ITEM_OUT_OF_RANGE',
            at: { pointer: '/bench/item' },
            params: { node: 'shout', item: 5, count: 1 },
          },
        ],
      },
    });
  });

  it('one item of a node with a stand-in needs the stand-in to reach that item only', async () => {
    const d = doc([
      {
        id: 'each',
        type: 'mail.send',
        forEach: '{{ input.to }}',
        input: { to: '{{ item }}' },
      },
    ]);
    const input = {
      to: ['a@example.test', 'b@example.test', 'c@example.test'],
    };
    const two = [{ id: 'zero' }, { id: 'one' }];
    const one = await run(
      d,
      { only: 'each', item: 1, mocks: { each: two } },
      input,
    );
    expect(one.status).toBe('success');
    expect(one.output).toEqual({ id: 'one' });
    expect(one.effects).toEqual([
      {
        node: 'each',
        connector: 'mail.send',
        input: { to: 'b@example.test' },
        item: 1,
      },
    ]);
    const past = await run(
      d,
      { only: 'each', item: 2, mocks: { each: two } },
      input,
    );
    expect(past.error?.message).toBe(
      'the test\'s simulated output for "each" has 2 entries, but this run picks item 2 — items count from 0',
    );
    // An item the list does not have is refused before any stand-in is
    // looked at.
    const outside = await run(
      d,
      { only: 'each', item: 3, mocks: { each: two } },
      input,
    );
    expect(outside.validation?.errors.map((i) => i.code)).toEqual([
      'BENCH_ITEM_OUT_OF_RANGE',
    ]);
  });
});

describe('a run’s time limit and its caller’s stop', () => {
  it('a run past its deadline stops before its next step', async () => {
    const result = await execute(TRIAGE, {
      mode: 'mock',
      deadline: Date.now() - 1,
    });
    expect(result.status).toBe('error');
    expect(result.stoppedBy).toBe('time_limit');
    expect(result.error?.message).toMatch(
      /^stopped after \d+ s — this run has a time limit$/,
    );
    expect(result.error?.nodeId).toBeUndefined();
    expect(result.trace.map((e) => e.status)).toEqual([
      'not_run',
      'not_run',
      'not_run',
    ]);
  });

  it('a stop between items stops the step it was in, whatever its onError', async () => {
    const d = doc(
      [
        {
          id: 'each',
          type: 'ping.send',
          forEach: '{{ [1, 2, 3] }}',
          input: {},
          onError: 'continue',
        },
        { id: 'after', type: 'transform', code: 'return 1;' },
      ],
      { output: '{{ nodes.after.output }}' },
    );
    const stop = new AbortController();
    onPing = () => stop.abort();
    try {
      const result = await execute(d, {
        mode: 'mock',
        signal: stop.signal,
        recorder: createRecorder({ now: () => Date.now() }),
      });
      expect(result.status).toBe('error');
      expect(result.stoppedBy).toBe('cancelled');
      expect(result.error).toEqual({ nodeId: 'each', message: 'stopped' });
      expect(result.effects).toHaveLength(1);
      expect(result.trace.map((e) => [e.node, e.status])).toEqual([
        ['each', 'error'],
        ['after', 'not_run'],
      ]);
      // The step it was in stays open in the record: it reads as stopped.
      const step = result.record?.find(
        (r) => r.key.path === 'each' && r.key.item < 0,
      );
      expect(step?.status).toBe('running');
    } finally {
      onPing = undefined;
    }
  });

  it('a stop inside a called automation stops its caller too', async () => {
    const store = memoryStore();
    store.save('child', {
      version: 1,
      name: 'child',
      nodes: [
        { id: 'first', type: 'ping.send', input: {} },
        { id: 'second', type: 'ping.send', input: {} },
      ],
      output: '{{ nodes.second.output }}',
    });
    const d = doc(
      [
        {
          id: 'call',
          type: 'subautomation',
          automation: 'child',
          onError: 'continue',
        },
        { id: 'after', type: 'transform', code: 'return 1;' },
      ],
      { output: '{{ nodes.after.output }}' },
    );
    const stop = new AbortController();
    onPing = () => stop.abort();
    try {
      const result = await execute(d, {
        mode: 'mock',
        store,
        signal: stop.signal,
      });
      expect(result.stoppedBy).toBe('cancelled');
      expect(result.trace.map((e) => [e.node, e.status])).toEqual([
        ['call', 'error'],
        ['after', 'not_run'],
      ]);
      // What the called automation did before it stopped happened: the
      // caller lists it, as it lists the effects of one that finished.
      expect(result.effects.map((e) => [e.node, e.connector])).toEqual([
        ['call/first', 'ping.send'],
      ]);
    } finally {
      onPing = undefined;
    }
  });

  it('keeps what a called automation did before it failed', async () => {
    const store = memoryStore();
    store.save('child', {
      version: 1,
      name: 'child',
      nodes: [
        { id: 'first', type: 'ping.send', input: {} },
        {
          id: 'boom',
          type: 'transform',
          input: { sent: '{{ nodes.first.output }}' },
          code: "throw new Error('the export is empty');",
        },
      ],
      output: '{{ nodes.boom.output }}',
    });
    const d = doc(
      [
        {
          id: 'call',
          type: 'subautomation',
          automation: 'child',
          onError: 'continue',
        },
        { id: 'after', type: 'transform', code: 'return 1;' },
      ],
      { output: '{{ nodes.after.output }}' },
    );
    const result = await execute(d, { mode: 'mock', store });
    expect(result.trace.map((e) => [e.node, e.status])).toEqual([
      ['call', 'error'],
      ['after', 'ok'],
    ]);
    // The write it made before failing happened: the caller lists it, as
    // the durable runtime does and as it lists a stopped one's.
    expect(result.effects.map((e) => [e.node, e.connector])).toEqual([
      ['call/first', 'ping.send'],
    ]);
  });
});

describe('what a recorded run keeps of its bench', () => {
  it('marks stood-in, failed and pinned steps; a left-out step has no record', async () => {
    const recorded = await execute(TRIAGE, {
      mode: 'mock',
      bench: {
        mocks: { inbox: { conversations: [{ from: 'ada@example.test' }] } },
        failures: { reply: 'locked' },
      },
      recorder: createRecorder({ now: () => Date.now() }),
    });
    const step = (path: string) =>
      recorded.record?.find(
        (r) => r.key.path === path && r.key.item < 0 && r.key.pass < 0,
      );
    expect(step('inbox')?.meta.bench).toBe('mocked');
    expect(step('pick')?.meta.bench).toBeUndefined();
    expect(step('reply')).toMatchObject({
      status: 'failed',
      meta: { bench: 'failed' },
      failure: { reason: 'SIMULATED_FAILURE', params: { message: 'locked' } },
    });

    const alone = await execute(TRIAGE, {
      mode: 'mock',
      bench: {
        only: 'reply',
        mocks: { pick: { to: 'ada@example.test', count: 0 } },
      },
      recorder: createRecorder({ now: () => Date.now() }),
    });
    const of = (path: string) =>
      alone.record?.find((r) => r.key.path === path && r.key.item < 0);
    expect(of('inbox')).toBeUndefined();
    expect(of('pick')).toMatchObject({
      status: 'ok',
      meta: { bench: 'pinned' },
      output: { value: { to: 'ada@example.test', count: 0 } },
    });
    expect(of('reply')?.meta.whenWouldSkip).toBe(true);
    // The document output is not evaluated: the End step has no record.
    expect(of('__end')).toBeUndefined();
  });
});

describe('a run’s failure, as a reason', () => {
  it('names why a step failed, and why the output did', async () => {
    const step = await execute(
      doc([{ id: 'boom', type: 'transform', code: 'return null;' }]),
      { mode: 'mock' },
    );
    expect(step.error?.failure).toMatchObject({
      code: 'node_error',
      reason: 'CODE_NO_RESULT',
    });
    const output = await execute(
      doc([{ id: 'ok', type: 'transform', code: 'return {};' }], {
        output: '{{ nodes.ok.output.a.b }}',
      }),
      { mode: 'mock' },
    );
    expect(output.error?.nodeId).toBeUndefined();
    expect(output.error?.failure).toMatchObject({
      reason: 'EXPR_READ_MISSING',
      at: { pointer: '/output' },
    });
  });
});

/** rows reads the sheet the input names; its output is the run's. */
const ROWS = doc(
  [{ id: 'rows', type: 'sheet.read', input: { sheet: '{{ input.sheet }}' } }],
  { output: '{{ nodes.rows.output }}' },
);

/** What `sheet.read`'s mock answers a call no scenario answers. */
const MOCK_ROWS = { rows: [], answered: 'mock' };

/** A mock run that keeps its record. */
const recorded = (d: Automation, bench: RunBench, input: unknown) =>
  execute(d, {
    input,
    mode: 'mock',
    bench,
    recorder: createRecorder({ now: () => Date.now() }),
  });

/** A step's own record, not one of its items' or passes'. */
const stepRecord = (result: RunResult, path: string) =>
  result.record?.find(
    (r) => r.key.path === path && r.key.item < 0 && r.key.pass < 0,
  );

/** A host for a live run that reaches nothing: the live body of
 * `sheet.read` throws before it would use it. */
function testHost() {
  const notFetched = (): never => {
    throw new Error('the test host performs no IO');
  };
  return {
    config: {},
    http: {
      get: notFetched,
      post: notFetched,
      put: notFetched,
      patch: notFetched,
      delete: notFetched,
    },
    base64Encode: (s: string) => Buffer.from(s).toString('base64'),
    base64Decode: (s: string) => Buffer.from(s, 'base64').toString('utf8'),
  };
}

/** The error a live call raises when the service refuses it: its message,
 * and the HTTP status the service answered with, when it answered. */
function raised(message: string, status?: number): Error {
  return Object.assign(
    new Error(message),
    status === undefined ? {} : { status },
  );
}

/** The automation run live, with no bench: the live body of `sheet.read`
 * throws `error`. */
function runLive(d: Automation, error: Error, input: unknown) {
  liveError = error;
  return execute(d, {
    input,
    mode: 'live',
    connectorHost: () => testHost(),
    recorder: createRecorder({ now: () => Date.now() }),
  });
}

/** A failure's cause: its family, its reason with its facts, and where in
 * the document it happened — what two runs that fail the same way share,
 * whatever their sentences say. */
function causeIn(failure: StepFailure | undefined) {
  return failure === undefined
    ? undefined
    : {
        code: failure.code,
        reason: failure.reason,
        params: failure.params,
        at: failure.at,
      };
}

const causeOf = (result: RunResult) => causeIn(result.error?.failure);

describe('a test picks a scenario its connector action ships, and it answers the call [AUTO-R78]', () => {
  it('the scenario’s output answers in the mock’s place, and the node is marked mocked', async () => {
    const result = await recorded(
      ROWS,
      { scenarios: { rows: 'two_rows' } },
      { sheet: 'Q2' },
    );
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ rows: [{ n: 1 }, { n: 2 }] });
    expect(result.trace).toMatchObject([
      {
        node: 'rows',
        status: 'ok',
        bench: 'mocked',
        input: { sheet: 'Q2' },
        output: { rows: [{ n: 1 }, { n: 2 }] },
      },
    ]);
    expect(stepRecord(result, 'rows')?.meta.bench).toBe('mocked');
    expect(result.unusedMocks).toBeUndefined();

    // Without the pick, the action's mock answers, and nothing stands in.
    const plain = await recorded(ROWS, {}, { sheet: 'Q2' });
    expect(plain.output).toEqual(MOCK_ROWS);
    expect(plain.trace[0]?.bench).toBeUndefined();
    expect(stepRecord(plain, 'rows')?.meta.bench).toBeUndefined();
  });

  it('the call still meets its connector’s input schema before a scenario answers it', async () => {
    const result = await run(
      ROWS,
      { scenarios: { rows: 'two_rows' } },
      { sheet: 3 },
    );
    expect(result.status).toBe('error');
    expect(result.error?.failure?.reason).toBe('CONNECTOR_INPUT_REFUSED');
    expect(result.trace[0]?.bench).toBeUndefined();
    expect(result.unusedMocks).toEqual(['rows']);
  });

  it('a write’s effect is recorded when its scenario answers, and not when the scenario fails it', async () => {
    const d = doc(
      [
        {
          id: 'save',
          type: 'sheet.append',
          input: { sheet: 'Q3', row: { n: '{{ input.n }}' } },
        },
      ],
      { output: '{{ nodes.save.output }}' },
    );
    const appended = await run(
      d,
      { scenarios: { save: 'appended' } },
      { n: 7 },
    );
    expect(appended.status).toBe('success');
    expect(appended.output).toEqual({ row: 7 });
    expect(appended.trace[0]?.bench).toBe('mocked');
    expect(appended.effects).toEqual([
      {
        node: 'save',
        connector: 'sheet.append',
        input: { sheet: 'Q3', row: { n: 7 } },
      },
    ]);

    const refused = await run(
      d,
      { scenarios: { save: 'protected' } },
      { n: 7 },
    );
    expect(refused.status).toBe('error');
    expect(refused.trace[0]?.bench).toBe('failed');
    // The call failed: it wrote nothing.
    expect(refused.effects).toEqual([]);
  });

  it('a run answers a copy of the shipped scenario: changing it changes neither the scenario nor the next run', async () => {
    const pick: RunBench = { scenarios: { rows: 'two_rows' } };
    const first = await run(ROWS, pick, { sheet: 'Q2' });
    const answered = first.trace[0]?.output as { rows: [{ n: number }] };
    answered.rows[0].n = 99;
    answered.rows.push({ n: 3 });
    expect(TWO_ROWS.output).toEqual({ rows: [{ n: 1 }, { n: 2 }] });

    const second = await run(ROWS, pick, { sheet: 'Q2' });
    expect(second.output).toEqual({ rows: [{ n: 1 }, { n: 2 }] });
  });

  it('a call whose input misses the scenario’s when runs the mock, and the pick goes unused', async () => {
    const elsewhere = await recorded(
      ROWS,
      { scenarios: { rows: 'q3_rows' } },
      { sheet: 'Q2' },
    );
    expect(elsewhere.status).toBe('success');
    expect(elsewhere.output).toEqual(MOCK_ROWS);
    expect(elsewhere.trace[0]?.bench).toBeUndefined();
    expect(stepRecord(elsewhere, 'rows')?.meta.bench).toBeUndefined();
    expect(elsewhere.unusedMocks).toEqual(['rows']);

    const q3 = await run(
      ROWS,
      { scenarios: { rows: 'q3_rows' } },
      { sheet: 'Q3' },
    );
    expect(q3.output).toEqual({ rows: [{ n: 3 }] });
    expect(q3.trace[0]?.bench).toBe('mocked');
    expect(q3.unusedMocks).toBeUndefined();

    // An error's when holds the same way: another sheet reads as the mock.
    const unlocked = await run(
      ROWS,
      { scenarios: { rows: 'q3_locked' } },
      { sheet: 'Q2' },
    );
    expect(unlocked.status).toBe('success');
    expect(unlocked.output).toEqual(MOCK_ROWS);
    expect(unlocked.unusedMocks).toEqual(['rows']);
  });

  it('per item, only the items whose input matches get the scenario; the others get the mock', async () => {
    const d = doc(
      [
        {
          id: 'each',
          type: 'sheet.read',
          forEach: '{{ input.sheets }}',
          input: { sheet: '{{ item }}' },
        },
      ],
      { output: '{{ nodes.each.output }}' },
    );
    const result = await recorded(
      d,
      { scenarios: { each: 'q3_rows' } },
      { sheets: ['Q2', 'Q3', 'Q4'] },
    );
    expect(result.status).toBe('success');
    expect(result.output).toEqual([MOCK_ROWS, { rows: [{ n: 3 }] }, MOCK_ROWS]);
    expect(result.trace[0]?.bench).toBe('mocked');
    expect(stepRecord(result, 'each')?.meta.bench).toBe('mocked');
    expect(result.unusedMocks).toBeUndefined();

    const none = await run(
      d,
      { scenarios: { each: 'q3_rows' } },
      { sheets: ['Q1', 'Q2'] },
    );
    expect(none.output).toEqual([MOCK_ROWS, MOCK_ROWS]);
    expect(none.trace[0]?.bench).toBeUndefined();
    expect(none.unusedMocks).toEqual(['each']);
  });

  it('a pick its node’s action does not ship is refused before anything runs', async () => {
    const result = await run(
      ROWS,
      { scenarios: { rows: 'rate_limit' } },
      { sheet: 'Q3' },
    );
    expect(result).toMatchObject({
      status: 'invalid',
      trace: [],
      effects: [],
      validation: {
        errors: [
          {
            code: 'BENCH_UNKNOWN_SCENARIO',
            at: { pointer: '/bench/scenarios/rows' },
            params: {
              node: 'rows',
              type: 'sheet.read',
              scenario: 'rate_limit',
              scenarios: SHEET_SCENARIOS.map((s) => s.name),
              suggestion: 'rate_limited',
            },
          },
        ],
        warnings: [],
      },
    });
  });

  it('a live run refuses a bench that picks a scenario', async () => {
    const result = await execute(ROWS, {
      input: { sheet: 'Q3' },
      mode: 'live',
      bench: { scenarios: { rows: 'two_rows' } },
    });
    expect(result.status).toBe('invalid');
    expect(result.trace).toEqual([]);
    expect(result.validation?.errors[0]).toMatchObject({
      code: 'BENCH_MOCK_ONLY',
      at: { pointer: '/bench' },
    });
  });
});

/** A scenario of `sheet.read`, the error a live call raises in its place,
 * and the cause both name. */
interface LiveFailureCase {
  scenario: string;
  message: string;
  status?: number;
  code: string;
  reason: string;
  /** The facts beside the connector and the action. */
  facts: Record<string, Json>;
}

describe('a scenario’s error fails the step as the same live failure would [AUTO-R79]', () => {
  it('a 429 is the rate limit a live call’s 429 is: the same reason, facts and family', async () => {
    const simulated = await run(
      ROWS,
      { scenarios: { rows: 'rate_limited' } },
      { sheet: 'Q3' },
    );
    const live = await runLive(ROWS, raised('too many requests', 429), {
      sheet: 'Q3',
    });
    expect(simulated.status).toBe('error');
    expect(live.status).toBe('error');
    expect(causeOf(simulated)).toEqual(causeOf(live));
    expect(causeOf(simulated)).toEqual({
      code: 'connector_unavailable',
      reason: 'CONNECTOR_RATE_LIMITED',
      params: { connector: 'sheet', action: 'sheet.read', status: 429 },
      at: { pointer: '/nodes/0' },
    });
    const failure = simulated.error?.failure;
    expect(reasonFamily(String(failure?.reason), failure?.params)).toBe(
      'connector_unavailable',
    );
  });

  it.each<LiveFailureCase>([
    {
      scenario: 'token_revoked',
      message: 'the token was revoked',
      status: 401,
      code: 'connector_error',
      reason: 'CONNECTOR_AUTH',
      facts: { status: 401 },
    },
    {
      scenario: 'no_access',
      message: 'no access to this sheet',
      status: 403,
      code: 'connector_error',
      reason: 'CONNECTOR_AUTH',
      facts: { status: 403 },
    },
    {
      scenario: 'no_such_sheet',
      message: 'no such sheet',
      status: 404,
      code: 'connector_error',
      reason: 'CONNECTOR_NOT_FOUND',
      facts: { status: 404 },
    },
    {
      scenario: 'server_down',
      message: 'the service is down',
      status: 503,
      code: 'connector_unavailable',
      reason: 'CONNECTOR_FAILED',
      facts: { status: 503, errorName: 'Error', detail: 'the service is down' },
    },
    {
      scenario: 'offline',
      message: 'fetch failed',
      code: 'connector_unavailable',
      reason: 'CONNECTOR_UNREACHABLE',
      facts: {},
    },
    {
      scenario: 'garbled',
      message: 'the service answered garbage',
      code: 'connector_error',
      reason: 'CONNECTOR_FAILED',
      facts: { errorName: 'Error', detail: 'the service answered garbage' },
    },
  ])(
    '$scenario fails as the live call it simulates does: $reason',
    async (c) => {
      const simulated = await run(
        ROWS,
        { scenarios: { rows: c.scenario } },
        { sheet: 'Q3' },
      );
      const live = await runLive(ROWS, raised(c.message, c.status), {
        sheet: 'Q3',
      });
      expect(causeOf(simulated)).toEqual(causeOf(live));
      expect(causeOf(simulated)).toEqual({
        code: c.code,
        reason: c.reason,
        params: { connector: 'sheet', action: 'sheet.read', ...c.facts },
        at: { pointer: '/nodes/0' },
      });
    },
  );

  it('the failure names the scenario and says the test simulated it', async () => {
    const simulated = await recorded(
      ROWS,
      { scenarios: { rows: 'rate_limited' } },
      { sheet: 'Q3' },
    );
    const message =
      'too many requests (the "rate_limited" scenario of sheet.read, simulated by the test)';
    expect(simulated.error).toMatchObject({
      nodeId: 'rows',
      message,
      failure: { message },
    });
    expect(simulated.trace).toMatchObject([
      {
        node: 'rows',
        status: 'error',
        bench: 'failed',
        input: { sheet: 'Q3' },
        error: message,
      },
    ]);
    expect(stepRecord(simulated, 'rows')).toMatchObject({
      status: 'failed',
      meta: { bench: 'failed' },
      failure: { reason: 'CONNECTOR_RATE_LIMITED', message },
    });

    // The live call's failure says what the service said, and no test.
    const live = await runLive(ROWS, raised('too many requests', 429), {
      sheet: 'Q3',
    });
    expect(live.error?.message).toBe('live call failed: too many requests');
    expect(live.trace[0]?.bench).toBeUndefined();
    expect(stepRecord(live, 'rows')?.meta.bench).toBeUndefined();
  });

  it('onError treats a scenario’s failure as it treats the live one', async () => {
    const d = doc(
      [
        {
          id: 'rows',
          type: 'sheet.read',
          input: { sheet: '{{ input.sheet }}' },
          onError: 'continue',
        },
        {
          id: 'after',
          type: 'transform',
          input: { rows: '{{ nodes.rows.output.rows }}' },
          code: 'return input.rows.length;',
        },
        { id: 'other', type: 'transform', code: 'return "ran";' },
      ],
      { output: '{{ nodes.other.output }}' },
    );
    const simulated = await recorded(
      d,
      { scenarios: { rows: 'rate_limited' } },
      { sheet: 'Q3' },
    );
    const live = await runLive(d, raised('too many requests', 429), {
      sheet: 'Q3',
    });
    for (const result of [simulated, live]) {
      expect(result.status).toBe('success');
      expect(result.output).toBe('ran');
      expect(result.trace.map((e) => [e.node, e.status])).toEqual([
        ['rows', 'error'],
        ['after', 'skipped'],
        ['other', 'ok'],
      ]);
      expect(result.trace[0]?.note).toBe(
        'onError: continue — dependents are skipped',
      );
      expect(stepRecord(result, 'rows')).toMatchObject({
        status: 'skipped',
        skip: { reason: 'error' },
        failure: { reason: 'CONNECTOR_RATE_LIMITED' },
      });
    }
    expect(causeIn(stepRecord(simulated, 'rows')?.failure)).toEqual(
      causeIn(stepRecord(live, 'rows')?.failure),
    );
  });

  it('per item, onItemError treats a scenario’s failure as any failed item: it is null, the others run', async () => {
    const d = doc(
      [
        {
          id: 'each',
          type: 'sheet.read',
          forEach: '{{ input.sheets }}',
          onItemError: 'continue',
          input: { sheet: '{{ item }}' },
        },
      ],
      { output: '{{ nodes.each.output }}' },
    );
    const result = await recorded(
      d,
      { scenarios: { each: 'q3_locked' } },
      { sheets: ['Q2', 'Q3', 'Q4'] },
    );
    expect(result.status).toBe('success');
    expect(result.output).toEqual([MOCK_ROWS, null, MOCK_ROWS]);
    expect(result.trace[0]).toMatchObject({
      status: 'ok',
      bench: 'failed',
      note: 'onItemError: continue — 1 of 3 items failed (item 1)',
    });
    expect(
      result.record?.find((r) => r.key.path === 'each' && r.key.item === 1),
    ).toMatchObject({
      status: 'failed',
      failure: {
        code: 'connector_error',
        reason: 'CONNECTOR_FAILED',
        params: {
          connector: 'sheet',
          action: 'sheet.read',
          errorName: 'Error',
          detail: 'the sheet is locked',
        },
      },
    });
  });
});
