import { describe, expect, it } from 'vitest';

import { absoluteLocalizedUrl } from './absolute-url';

describe('absoluteLocalizedUrl', () => {
  it('keeps English at the unprefixed origin path', () => {
    expect(absoluteLocalizedUrl('en', '/')).toBe('https://tale.dev/');
    expect(absoluteLocalizedUrl('en', '/platform')).toBe(
      'https://tale.dev/platform',
    );
  });

  it('prefixes de and fr', () => {
    expect(absoluteLocalizedUrl('de', '/platform')).toBe(
      'https://tale.dev/de/platform',
    );
    expect(absoluteLocalizedUrl('fr', '/platform/agents')).toBe(
      'https://tale.dev/fr/platform/agents',
    );
  });
});
