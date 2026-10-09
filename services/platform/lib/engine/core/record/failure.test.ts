// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  classifyStepFailure,
  exprFailureOf,
  failureCauseOf,
  fieldOf,
} from './failure';

const at = { pointer: '/nodes/2/when', range: [0, 20] as [number, number] };

describe('exprFailureOf', () => {
  it('reads a member read of a missing value, and the chain that held it', () => {
    const reads = () => [
      { chain: 'nodes.fetch', key: 'output', source: 'fetch' },
      { chain: 'nodes.fetch.output', key: 'items', source: 'fetch' },
      { chain: 'nodes.fetch.output.items', key: 'length', source: 'fetch' },
    ];
    expect(
      exprFailureOf(
        "Cannot read properties of undefined (reading 'length')",
        'nodes.fetch.output.items.length > 0',
        at,
        reads,
      ),
    ).toEqual({
      reason: 'EXPR_READ_MISSING',
      params: {
        field: 'when',
        expr: 'nodes.fetch.output.items.length > 0',
        key: 'length',
        base: 'undefined',
        chain: 'nodes.fetch.output.items',
        source: 'fetch',
      },
      at,
    });
  });

  it('names no chain when two reads take the same key', () => {
    const cause = exprFailureOf(
      "TypeError: Cannot read properties of null (reading 'id')",
      'input.a.id + input.b.id',
      undefined,
      () => [
        { chain: 'input.a', key: 'id' },
        { chain: 'input.b', key: 'id' },
      ],
    );
    expect(cause).toEqual({
      reason: 'EXPR_READ_MISSING',
      params: { expr: 'input.a.id + input.b.id', key: 'id', base: 'null' },
    });
  });

  it('reads the older wording of a missing member', () => {
    expect(
      exprFailureOf("Cannot read property 'x' of undefined", 'input.a.x', at)
        .params,
    ).toMatchObject({ key: 'x', base: 'undefined' });
  });

  it.each([
    ['nope is not defined', 'EXPR_NAME_UNKNOWN', { name: 'nope' }],
    [
      'ReferenceError: nope is not defined',
      'EXPR_NAME_UNKNOWN',
      { name: 'nope' },
    ],
    [
      'input.list.mapp is not a function',
      'EXPR_NOT_FUNCTION',
      { callee: 'input.list.mapp' },
    ],
    [
      'Script execution timed out after 1000ms',
      'EXPR_TIMEOUT',
      { limitMs: 1000 },
    ],
    [
      'evaluation timed out after 1000ms; the node-vm runner process was killed',
      'EXPR_TIMEOUT',
      { limitMs: 1000 },
    ],
    ["Unexpected token ')'", 'EXPR_SYNTAX', { detail: "Unexpected token ')'" }],
    [
      'RangeError: Invalid array length',
      'EXPR_FAILED',
      { errorName: 'RangeError', detail: 'RangeError: Invalid array length' },
    ],
    ['boom', 'EXPR_FAILED', { detail: 'boom' }],
  ])('reads "%s" as %s', (message, reason, params) => {
    const cause = exprFailureOf(message, 'x', at);
    expect(cause.reason).toBe(reason);
    expect(cause.params).toMatchObject({ field: 'when', ...params });
    expect(cause.at).toEqual(at);
  });
});

describe('fieldOf', () => {
  it.each([
    ['/nodes/3/input/query', 'input.query'],
    ['/nodes/0/when', 'when'],
    ['/output/total', 'output.total'],
    ['/nodes/1/input/a~1b', 'input.a/b'],
  ])('%s → %s', (pointer, field) => {
    expect(fieldOf(pointer)).toBe(field);
  });
});

describe('classifyStepFailure', () => {
  it('keeps the cause a failure site gave', () => {
    const error = Object.assign(new Error('boom'), {
      failure: {
        reason: 'FOREACH_NOT_LIST',
        params: { expr: 'input.items', kind: 'undefined' },
        at: { pointer: '/nodes/1/forEach', range: [3, 14] },
      },
    });
    expect(
      classifyStepFailure(error, {
        code: 'node_error',
        message: 'boom',
        hint: 'check it',
        pointer: '/nodes/1',
      }),
    ).toEqual({
      code: 'node_error',
      reason: 'FOREACH_NOT_LIST',
      params: { expr: 'input.items', kind: 'undefined' },
      message: 'boom',
      hint: 'check it',
      at: { pointer: '/nodes/1/forEach', range: [3, 14] },
    });
  });

  it('falls back to UNKNOWN at the step, with the text as a detail', () => {
    expect(
      classifyStepFailure(new Error('odd'), {
        code: 'node_error',
        message: 'odd',
        pointer: '/nodes/4',
      }),
    ).toEqual({
      code: 'node_error',
      reason: 'UNKNOWN',
      params: { detail: 'odd' },
      message: 'odd',
      at: { pointer: '/nodes/4' },
    });
  });

  it('withholds a credential in a parameter and cuts long ones', () => {
    const token = `ghp_${'a'.repeat(30)}`;
    const failure = classifyStepFailure(
      {
        failure: {
          reason: 'EXPR_FAILED',
          params: {
            detail: `bad ${token}`,
            expr: 'y'.repeat(500),
            list: ['z'],
          },
        },
      },
      { code: 'node_error', message: 'm' },
    );
    expect(failure.params.detail).toBeNull();
    expect(failure.params.expr).toBe('y'.repeat(200));
    expect(failure.params.list).toEqual(['z']);
  });

  it('reads no cause from a value that does not carry one', () => {
    expect(failureCauseOf({ failure: 'text' })).toBeUndefined();
    expect(failureCauseOf(null)).toBeUndefined();
    expect(failureCauseOf('x')).toBeUndefined();
  });
});
