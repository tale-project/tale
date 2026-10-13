import { describe, expect, it } from 'vitest';

import { deriveFallbackTitle } from './derive-fallback-title';

/**
 * The fallback is the last line of defence against a wall of "Untitled chat"
 * rows: it must produce SOMETHING readable for any non-empty message, and
 * nothing at all (never a blank) for an empty one.
 */
describe('deriveFallbackTitle', () => {
  it('returns a short message unchanged', () => {
    expect(deriveFallbackTitle('How do I configure git?')).toBe(
      'How do I configure git?',
    );
  });

  it('collapses runs of whitespace, including newlines', () => {
    expect(deriveFallbackTitle('  fix\n\nthe   build\tplease ')).toBe(
      'fix the build please',
    );
  });

  it('truncates a long message at 60 characters with an ellipsis', () => {
    const long = 'a'.repeat(59) + ' tail that goes on and on';
    const title = deriveFallbackTitle(long);
    expect(title).toBe(`${'a'.repeat(59)}…`);
    expect(title?.length).toBeLessThanOrEqual(61);
  });

  it('trims trailing whitespace left by the cut before appending the ellipsis', () => {
    const source = `${'word '.repeat(12)}end`;
    const title = deriveFallbackTitle(source);
    expect(title?.endsWith(' …')).toBe(false);
    expect(title?.endsWith('…')).toBe(true);
  });

  it('returns null for empty and all-whitespace sources', () => {
    expect(deriveFallbackTitle('')).toBeNull();
    expect(deriveFallbackTitle('   \n\t ')).toBeNull();
  });
});
