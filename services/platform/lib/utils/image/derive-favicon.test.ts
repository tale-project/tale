import { describe, it, expect } from 'vitest';

import { shouldDeriveFavicon } from './derive-favicon';

describe('shouldDeriveFavicon', () => {
  it('derives when no favicon exists in any slot', () => {
    expect(shouldDeriveFavicon({})).toBe(true);
    expect(
      shouldDeriveFavicon({
        faviconLightFilename: '',
        faviconDarkFilename: '',
        faviconLightUrl: null,
        faviconDarkUrl: null,
      }),
    ).toBe(true);
  });

  it('does not derive when a favicon is already set', () => {
    expect(
      shouldDeriveFavicon({ faviconLightFilename: 'favicon-light.png' }),
    ).toBe(false);
    expect(
      shouldDeriveFavicon({ faviconDarkFilename: 'favicon-dark.png' }),
    ).toBe(false);
    expect(
      shouldDeriveFavicon({ faviconLightUrl: 'https://x/favicon-light.png' }),
    ).toBe(false);
    expect(
      shouldDeriveFavicon({ faviconDarkUrl: 'https://x/favicon-dark.png' }),
    ).toBe(false);
  });
});
