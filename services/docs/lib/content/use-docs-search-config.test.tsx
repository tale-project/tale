import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BASE_LOCALES } from '@/lib/i18n/locales';

import { useDocsSearchConfig } from './use-docs-search-config';

/**
 * Each language searches an index of its own, so a recent search names its
 * page in the language it was made in. One store for every language would
 * list a German reader the English titles of an earlier English session.
 */
describe('useDocsSearchConfig', () => {
  it('keeps the recent searches of each language apart', () => {
    const keys = BASE_LOCALES.map(
      (locale) =>
        renderHook(() => useDocsSearchConfig(locale)).result.current
          .recentsStorageKey,
    );
    expect(new Set(keys).size).toBe(BASE_LOCALES.length);
  });

  it('stores recents next to the index of the same language', () => {
    const { result } = renderHook(() => useDocsSearchConfig('de'));
    expect(result.current).toMatchObject({
      indexUrl: '/search-index-de.json',
      recentsStorageKey: 'tale.docs.recentSearches.v1.de',
    });
  });
});
