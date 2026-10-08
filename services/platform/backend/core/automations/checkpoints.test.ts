import { describe, expect, it } from 'vitest';

import { parseRunCheckpoints, readCheckpoints } from './checkpoints.ts';

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
