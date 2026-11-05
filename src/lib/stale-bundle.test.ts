import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  claimReload,
  failedChunkUrl,
  isChunkLoadFailure,
  releaseReload,
} from './stale-bundle';

const CHUNK = 'https://tale.example/assets/pricing-page-C4h9kQ2x.js';

describe('isChunkLoadFailure', () => {
  it.each([
    ['Chromium', `Failed to fetch dynamically imported module: ${CHUNK}`],
    ['Firefox', `error loading dynamically imported module: ${CHUNK}`],
    ['WebKit', 'Importing a module script failed.'],
    [
      'a stylesheet of the chunk',
      'Unable to preload CSS for https://tale.example/assets/pricing-page-D0c5sX1a.css',
    ],
  ])('recognizes a chunk %s could not fetch', (_source, message) => {
    expect(isChunkLoadFailure(new TypeError(message))).toBe(true);
  });

  it('leaves a module that loaded and then threw, and anything not an error', () => {
    expect(
      isChunkLoadFailure(new ReferenceError('pdfjsLib is not defined')),
    ).toBe(false);
    expect(isChunkLoadFailure(new TypeError('Failed to fetch'))).toBe(false);
    expect(
      isChunkLoadFailure(`Failed to fetch dynamically imported module`),
    ).toBe(false);
    expect(isChunkLoadFailure(undefined)).toBe(false);
  });
});

describe('failedChunkUrl', () => {
  it('names the chunk the message names, and one shared slot otherwise', () => {
    expect(
      failedChunkUrl(
        new TypeError(`Failed to fetch dynamically imported module: ${CHUNK}`),
      ),
    ).toBe(CHUNK);
    expect(
      failedChunkUrl(new TypeError('Importing a module script failed.')),
    ).toBe('unknown');
  });
});

describe('claimReload', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('grants the reload under a key once per session, until it is handed back', () => {
    expect(claimReload('reload:a')).toBe(true);
    expect(claimReload('reload:a')).toBe(false);
    expect(claimReload('reload:b')).toBe(true);

    releaseReload('reload:a');
    expect(claimReload('reload:a')).toBe(true);
  });

  it('refuses the reload when it cannot be remembered', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException(
        'The quota has been exceeded.',
        'QuotaExceededError',
      );
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(claimReload('reload:a')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
