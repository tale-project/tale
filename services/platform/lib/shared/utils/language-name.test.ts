import { describe, expect, it, vi } from 'vitest';

import { languageDisplayName } from './language-name';

/**
 * The fixed-reply-language directive names the language in words. The
 * regression under test: the REST send's `locale` reached the prompt as a
 * raw tag ("Answer in de …"), and a reasoning model on a short prompt
 * answered in the prompt's language anyway.
 */

describe('languageDisplayName', () => {
  it('names the language in English, region and script included', () => {
    expect(languageDisplayName('de')).toBe('German');
    expect(languageDisplayName('en-GB')).toBe('British English');
    expect(languageDisplayName('de-CH')).toBe('Swiss High German');
    expect(languageDisplayName('zh-Hant')).toBe('Traditional Chinese');
  });

  it('answers the tag itself when the runtime has no name for it, and never throws', () => {
    // Well-formed but unknown: the runtime's own code fallback.
    expect(languageDisplayName('xx')).toBe('xx');
    // Not a language tag at all: the runtime throws, the caller gets the
    // input back and a log line — never an exception on the prompt path.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(languageDisplayName('de_DE')).toBe('de_DE');
      expect(languageDisplayName('')).toBe('');
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
