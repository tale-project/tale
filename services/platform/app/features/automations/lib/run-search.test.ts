import { describe, expect, it } from 'vitest';

import { runSearchNode, runSearchSchema } from './run-search';

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
