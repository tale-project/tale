import { describe, expect, it } from 'vitest';

import {
  applyRunSearchChange,
  runSearchNode,
  runSearchSchema,
  runSearchSelection,
} from './run-search';

describe('runSearchSchema', () => {
  it('reads every part of a link', () => {
    expect(
      runSearchSchema.parse({
        view: 'steps',
        node: 'send',
        tab: 'error',
        item: '3',
        pass: '0',
        t: '1520',
      }),
    ).toEqual({
      view: 'steps',
      node: 'send',
      tab: 'error',
      item: 3,
      pass: 0,
      t: 1520,
    });
  });

  it('drops what does not read, and still opens the run', () => {
    expect(
      runSearchSchema.parse({
        view: 'graph',
        tab: 'logs',
        item: '-1',
        t: 'soon',
        node: 'x'.repeat(200),
      }),
    ).toEqual({});
  });
});

describe('runSearchNode', () => {
  it('reads a condition as its step, and the run’s ends as themselves', () => {
    expect(runSearchNode({ node: '__gate:notify' })).toBe('notify');
    expect(runSearchNode({ node: 'notify' })).toBe('notify');
    expect(runSearchNode({ node: '__start' })).toBe('__start');
    expect(runSearchNode({ node: '__end' })).toBe('__end');
    expect(runSearchNode({})).toBeUndefined();
  });
});

describe('applyRunSearchChange', () => {
  it('writes what changed, drops what was cleared, and keeps the rest', () => {
    const previous = { view: 'steps' as const, node: 'score', item: 2, t: 900 };
    expect(
      applyRunSearchChange(previous, { node: 'send', item: null }),
    ).toEqual({ view: 'steps', node: 'send', t: 900 });
    expect(applyRunSearchChange(previous, { view: null, pass: 0 })).toEqual({
      node: 'score',
      item: 2,
      pass: 0,
      t: 900,
    });
    // The previous search is left as it was.
    expect(previous).toEqual({ view: 'steps', node: 'score', item: 2, t: 900 });
  });
});

describe('runSearchSelection', () => {
  it('opens a link’s step with its item or pass, and nothing for the run’s ends', () => {
    expect(runSearchSelection({ node: 'score', item: 2 })).toEqual({
      node: 'score',
      unit: { item: 2 },
    });
    expect(runSearchSelection({ node: '__gate:poll', pass: 0 })).toEqual({
      node: 'poll',
      unit: { pass: 0 },
    });
    expect(runSearchSelection({ node: 'score' })).toEqual({
      node: 'score',
      unit: null,
    });
    expect(runSearchSelection({ node: '__end', item: 1 })).toEqual({
      node: null,
      unit: null,
    });
    expect(runSearchSelection({ item: 1 })).toEqual({ node: null, unit: null });
    expect(runSearchSelection(undefined)).toEqual({ node: null, unit: null });
  });
});
