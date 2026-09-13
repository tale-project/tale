import { describe, expect, it } from 'vitest';

import { hasForbiddenNameChar } from './plain-name.ts';

/**
 * One character class behind every name in the organization tree — the
 * folder domain, the REST file name, the WebDAV segment. The regression
 * under test: the folder rule refused `/` alone, so `a\b` and a name with
 * a tab or a NUL were stored while the file rule beside it refused them.
 */
describe('hasForbiddenNameChar', () => {
  it.each([
    ['a slash', 'a/b'],
    ['a backslash', 'a\\b'],
    ['a NUL', 'a\u0000b'],
    ['a tab', 'a\tb'],
    ['a line break', 'a\nb'],
    ['a carriage return', 'a\rb'],
    ['an escape', 'a\u001bb'],
    ['DEL', 'a\u007fb'],
  ])('refuses a name carrying %s', (_what, name) => {
    expect(hasForbiddenNameChar(name)).toBe(true);
  });

  it.each([
    '2026-Q1 invoices',
    'café.pdf',
    'Aux materials.pdf',
    'report..v2.pdf',
    '日本語',
    'quarter 📁',
    'a\u00a0b',
  ])(
    'lets %j through — spaces, accents, scripts and symbols are names',
    (name) => {
      expect(hasForbiddenNameChar(name)).toBe(false);
    },
  );
});
