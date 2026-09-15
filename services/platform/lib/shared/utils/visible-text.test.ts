import { describe, expect, it } from 'vitest';

import { hasVisibleText } from './visible-text';

/**
 * The blank rule behind every "must not be blank" on the REST door and the
 * composer's Send. The regression under test: a prompt of zero-width spaces
 * passed `trim()` and ran a billed turn (2026-09-14 evaluation, h2).
 */
describe('hasVisibleText', () => {
  it.each([
    ['', 'empty'],
    ['   \n\t', 'ASCII whitespace'],
    ['\u00a0', 'NO-BREAK SPACE'],
    ['\u0085', 'NEL — White_Space but not ECMAScript WhiteSpace'],
    ['\u200b\u200b', 'ZERO WIDTH SPACE ×2 — the lane’s prompt'],
    ['\u200c\u200d', 'zero-width non-joiner and joiner'],
    ['\u2060\ufeff', 'WORD JOINER and BOM'],
    ['\u00ad', 'SOFT HYPHEN'],
    ['\ufe0f', 'VARIATION SELECTOR-16'],
    ['\u202e', 'RIGHT-TO-LEFT OVERRIDE'],
    ['\u{e0041}', 'a tag character'],
    ['\u3164', 'HANGUL FILLER'],
    [' \u200b \u2060 ', 'a mix of the above'],
  ])('reads %j as blank (%s)', (text) => {
    expect(hasVisibleText(text)).toBe(false);
  });

  it.each([
    ['a', 'one letter'],
    [' a ', 'a letter with padding'],
    [
      '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}',
      'a ZWJ family emoji — the joiners are content',
    ],
    ['a\u200bb', 'a zero-width space between letters'],
    [
      '```\n```',
      'an empty code fence — markdown that renders as nothing is still text',
    ],
    ['---', 'a rule'],
    ['\u00e9', 'a non-ASCII letter'],
  ])('reads %j as visible (%s)', (text) => {
    expect(hasVisibleText(text)).toBe(true);
  });
});
