import { describe, expect, it } from 'vitest';

import {
  effectsFrom,
  mergeParkedAgentCursor,
  parkedAgentSettled,
  parseRunCheckpoints,
  readCheckpoints,
  traceFrom,
} from './checkpoints.ts';

const NODE = {
  status: 'ok',
  output: { sent: true },
  trace: { node: 'send', type: 'webdav.write', status: 'ok' },
  effects: [],
};

const CURSOR = { node: 'fan', index: 2, passes: 0, outs: [1, 2] };

describe('parseRunCheckpoints', () => {
  it.each([
    ['no value', null],
    ['an absent value', undefined],
    ['an empty object', {}],
  ])('reads %s as a run with nothing done', (_label, value) => {
    expect(parseRunCheckpoints(value)).toEqual({
      ok: true,
      checkpoints: { nodes: {}, executions: 0 },
    });
  });

  it('reads finished nodes, a cursor and the execution count', () => {
    expect(
      parseRunCheckpoints({
        nodes: { send: NODE },
        cursor: CURSOR,
        executions: 4,
      }),
    ).toEqual({
      ok: true,
      checkpoints: { nodes: { send: NODE }, cursor: CURSOR, executions: 4 },
    });
  });

  it('keeps fields a later release adds and counts a missing execution count as none', () => {
    const parsed = parseRunCheckpoints({
      nodes: {},
      cursor: { ...CURSOR, pins: { batch: 3 }, heldFor: 'a later field' },
      laterKey: true,
    });
    expect(parsed).toMatchObject({
      ok: true,
      checkpoints: {
        cursor: { pins: { batch: 3 }, heldFor: 'a later field' },
        executions: 0,
      },
    });
  });

  it('reads an agent turn parked on the cursor', () => {
    expect(
      parseRunCheckpoints({
        nodes: {},
        executions: 1,
        cursor: {
          node: 'repair',
          index: 0,
          passes: 0,
          outs: [],
          agent: { execId: 'exec-1', sessionId: 'session-1' },
        },
      }).ok,
    ).toBe(true);
  });

  it.each<[string, unknown, string]>([
    ['a list', [], 'the saved progress is not an object'],
    ['a string', 'nodes', 'the saved progress is not an object'],
    ['no steps', { executions: 2 }, 'the saved progress lists no steps'],
    [
      'steps that are a list',
      { nodes: [], executions: 0 },
      'the saved progress lists no steps',
    ],
    [
      'a step with an unknown status',
      { nodes: { send: { ...NODE, status: 'done' } } },
      'node "send" has no ok or skipped status',
    ],
    [
      'a step without a trace',
      { nodes: { send: { ...NODE, trace: undefined } } },
      'node "send" has no trace',
    ],
    [
      'a step without an effects list',
      { nodes: { send: { ...NODE, effects: {} } } },
      'node "send" has no effects list',
    ],
    [
      'a cursor without a node',
      { nodes: {}, cursor: { ...CURSOR, node: 3 } },
      'the cursor names no node',
    ],
    [
      'a cursor with a negative item',
      { nodes: {}, cursor: { ...CURSOR, index: -1 } },
      'the cursor has no item index or pass count',
    ],
    [
      'a cursor without outputs',
      { nodes: {}, cursor: { ...CURSOR, outs: undefined } },
      'the cursor has no outputs list',
    ],
    [
      'an agent turn without an exec',
      { nodes: {}, cursor: { ...CURSOR, agent: { sessionId: 's' } } },
      "the cursor's agent turn names no exec or session",
    ],
    [
      'subautomation versions that are not numbers',
      { nodes: {}, cursor: { ...CURSOR, pins: { batch: 'latest' } } },
      "the cursor's subautomation versions are not numbers",
    ],
    [
      'an execution count that is not a number',
      { nodes: {}, executions: 'many' },
      'the execution count is not a number',
    ],
  ])('refuses %s', (_label, value, reason) => {
    expect(parseRunCheckpoints(value)).toEqual({ ok: false, reason });
  });

  it('leaves the display reader lenient', () => {
    expect(readCheckpoints('nodes')).toEqual({ nodes: {}, executions: 0 });
  });
});

describe('mergeParkedAgentCursor', () => {
  const turn = (node: string, agent: Record<string, unknown>) => ({
    node,
    index: 0,
    passes: 0,
    outs: [],
    agent: { sessionId: 'sess_1', deadlineAt: 1_000, ...agent },
  });

  it('keeps the later deadline an answer gave the same turn while its question waits', () => {
    const merged = mergeParkedAgentCursor(
      turn('review', { execId: 'exec_1', deadlineAt: 5_000 }),
      turn('review', { execId: 'exec_1', deadlineAt: 1_000 }),
    );
    expect(merged).toMatchObject({
      agent: { execId: 'exec_1', deadlineAt: 5_000 },
    });
    expect(parkedAgentSettled(merged)).toBe(false);
  });

  it('keeps a result the walker already carries', () => {
    const mine = turn('review', { execId: 'exec_1', result: { text: 'a' } });
    expect(
      mergeParkedAgentCursor(
        turn('review', { execId: 'exec_1', result: { text: 'b' } }),
        mine,
      ),
    ).toEqual(mine);
  });

  it.each([
    ['another node', turn('summary', { execId: 'exec_1', result: {} })],
    ['no agent turn', { node: 'review', index: 0, passes: 0, outs: [] }],
    ['no stored progress', null],
  ])('writes the walker’s cursor as it is over %s', (_case, stored) => {
    const mine = turn('review', { execId: 'exec_1' });
    expect(mergeParkedAgentCursor(stored, mine)).toBe(mine);
  });
});

describe('a replay’s reused steps', () => {
  const checkpoints = {
    nodes: {
      fetch: {
        status: 'ok' as const,
        output: { n: 1 },
        trace: { node: 'fetch', type: 'http.get', status: 'ok' as const },
        effects: [{ node: 'fetch', connector: 'http', input: { url: 'a' } }],
        reused: { runId: 'run-source' },
      },
      send: {
        status: 'ok' as const,
        output: { sent: true },
        trace: { node: 'send', type: 'smtp.send', status: 'ok' as const },
        effects: [{ node: 'send', connector: 'smtp', input: { to: 'b' } }],
      },
    },
    executions: 1,
  };

  it('keeps them in the trace, saying where they came from', () => {
    expect(traceFrom(checkpoints, ['fetch', 'send'])).toEqual([
      {
        node: 'fetch',
        type: 'http.get',
        status: 'ok',
        note: 'reused from run run-source',
      },
      { node: 'send', type: 'smtp.send', status: 'ok' },
    ]);
  });

  it('leaves their effects out: the run did only what it ran', () => {
    expect(effectsFrom(checkpoints, ['fetch', 'send'])).toEqual([
      { node: 'send', connector: 'smtp', input: { to: 'b' } },
    ]);
  });

  it('reads a reused entry back as a finished step', () => {
    expect(parseRunCheckpoints(checkpoints)).toEqual({
      ok: true,
      checkpoints,
    });
  });
});
