import { describe, expect, it } from 'vitest';

import { replaceUpToLast, upToLast } from './markup-scan';

describe('upToLast', () => {
  it('ends at the last terminator, inclusive', () => {
    expect(upToLast('<a>one</a> <a>two</a> tail <a', '</a>')).toBe(
      '<a>one</a> <a>two</a>',
    );
  });

  it('takes a pattern terminator in any case', () => {
    expect(upToLast('<A>one</A> tail', /<\/a>/gi)).toBe('<A>one</A>');
  });

  it('is empty when the input has no terminator', () => {
    expect(upToLast('<a <a <a', '>')).toBe('');
  });
});

describe('replaceUpToLast', () => {
  it('replaces as `replace` does where a match can end', () => {
    expect(replaceUpToLast('<b>x</b> and <i>y</i>', '>', /<[^>]*>/g, '')).toBe(
      'x and y',
    );
  });

  it('leaves what follows the last terminator as it is', () => {
    expect(replaceUpToLast('<b>x</b> <b <b', '>', /<[^>]*>/g, '')).toBe(
      'x <b <b',
    );
    expect(replaceUpToLast('<b <b <b', '>', /<[^>]*>/g, '')).toBe('<b <b <b');
  });

  it('hands the groups to a replacer function', () => {
    expect(
      replaceUpToLast('<h2>Title</h2>', '>', /<h([1-6])>/g, (_whole, level) =>
        '#'.repeat(Number(level)),
      ),
    ).toBe('##Title</h2>');
  });
});
