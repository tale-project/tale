/**
 * The labels field splits on commas and keeps every entry (#3753): nothing
 * past the eighth is dropped before the door can say it takes eight.
 */

import { describe, expect, it } from 'vitest';

import { labelsProblem, parseLabelsInput } from './skill-metadata-fields';

describe('parseLabelsInput', () => {
  it('keeps every entry, trimmed, without empty ones', () => {
    const typed = Array.from({ length: 9 }, (_, i) => ` label-${i + 1} `);
    expect(parseLabelsInput(`${typed.join(',')},, `)).toEqual(
      typed.map((label) => label.trim()),
    );
  });
});

describe('labelsProblem', () => {
  const labels = (n: number) =>
    Array.from({ length: n }, (_, i) => `label-${i + 1}`).join(', ');

  it('accepts up to eight labels of up to forty characters', () => {
    expect(labelsProblem('')).toBeNull();
    expect(labelsProblem(labels(8))).toBeNull();
    expect(labelsProblem('x'.repeat(40))).toBeNull();
  });

  it('counts the labels past the cap', () => {
    expect(labelsProblem(labels(9))).toEqual({ kind: 'tooMany', count: 9 });
    expect(labelsProblem(`${labels(8)}, , `)).toBeNull();
  });

  it('names a label past the length cap', () => {
    expect(labelsProblem(`finance, ${'x'.repeat(41)}`)).toEqual({
      kind: 'tooLong',
      label: 'x'.repeat(41),
    });
  });
});
