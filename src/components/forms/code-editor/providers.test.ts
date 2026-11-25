import { describe, expect, it } from 'vitest';

import {
  combineProviders,
  type CodeCompletionContext,
  type CodeHoverContext,
} from './providers';

const signal = new AbortController().signal;

const completionContext: CodeCompletionContext = {
  text: 'nodes.',
  pos: 6,
  language: 'javascript',
  region: 'code',
  path: ['nodes'],
  prefix: '',
  from: 6,
  to: 6,
  explicit: false,
  signal,
};

const hoverContext: CodeHoverContext = {
  text: 'nodes.a',
  pos: 6,
  language: 'javascript',
  region: 'code',
  path: ['nodes', 'a'],
  word: 'a',
  from: 6,
  to: 7,
  signal,
};

describe('combineProviders', () => {
  it('concatenates completions with one item per label, the higher boost winning', async () => {
    const combined = combineProviders(
      {
        completion: () => ({
          items: [
            { label: 'a', detail: 'from shapes' },
            { label: 'b', boost: 2 },
          ],
          validFor: /^\w*$/,
        }),
      },
      undefined,
      {
        completion: async () => ({
          items: [
            { label: 'a', detail: 'from types', boost: 1 },
            { label: 'b', boost: 0 },
            { label: 'c' },
          ],
        }),
      },
    );
    const result = await combined.completion?.(completionContext);
    expect(result?.items.map((item) => [item.label, item.detail])).toEqual([
      ['a', 'from types'],
      ['b', undefined],
      ['c', undefined],
    ]);
    expect(result?.validFor).toEqual(/^\w*$/);
  });

  it('answers null when no provider completes', async () => {
    const combined = combineProviders({ completion: () => null });
    expect(await combined.completion?.(completionContext)).toBeNull();
  });

  it('takes the first hover answer', async () => {
    const combined = combineProviders(
      { hover: () => null },
      { hover: async () => ({ type: 'string', title: 'nodes.a' }) },
      { hover: () => ({ type: 'never' }) },
    );
    expect(await combined.hover?.(hoverContext)).toEqual({
      type: 'string',
      title: 'nodes.a',
    });
  });

  it('concatenates problems with one per code and range', async () => {
    const combined = combineProviders(
      {
        lint: () => [
          {
            id: '1',
            severity: 'error',
            message: 'A',
            code: 'X',
            range: [0, 1],
          },
        ],
        lintDelay: 300,
      },
      {
        lint: async () => [
          {
            id: '2',
            severity: 'error',
            message: 'A again',
            code: 'X',
            range: [0, 1],
          },
          {
            id: '3',
            severity: 'warning',
            message: 'B',
            code: 'X',
            range: [2, 3],
          },
        ],
        lintDelay: 100,
      },
    );
    const found = await combined.lint?.({
      text: 'abc',
      language: 'javascript',
      signal,
    });
    expect(found?.map((d) => d.id)).toEqual(['1', '3']);
    expect(combined.lintDelay).toBe(100);
  });

  it('leaves out what no provider offers', () => {
    expect(combineProviders(undefined, {})).toEqual({});
  });
});
