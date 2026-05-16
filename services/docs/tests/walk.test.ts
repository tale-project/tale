import { describe, expect, it } from 'vitest';

import {
  BASE_LOCALES,
  discoverLocales,
  filesInLocale,
  walkDocs,
} from './lib/walk';

/**
 * Sanity check for the harness itself.
 *
 * If any of these assertions trip, the rest of the suite will give garbage
 * results — there's no point flagging "0 findings" on an empty corpus. This
 * file runs first so a misconfigured `CONTENT_ROOT` or a missing locale dir
 * surfaces with a clear error.
 */

describe('docs walker sanity', () => {
  it('finds at least one page anywhere in the content tree', () => {
    expect(walkDocs().length).toBeGreaterThan(0);
  });

  it('discovers every base locale (en, de, fr)', () => {
    const discovered = discoverLocales();
    for (const code of BASE_LOCALES) {
      expect(discovered).toContain(code);
    }
  });

  it.each(BASE_LOCALES)('finds at least one page in %s/', (locale) => {
    expect(filesInLocale(locale).length).toBeGreaterThan(0);
  });
});
