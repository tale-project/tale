import type { DocsSearchConfig } from '@tale/ui/docs/docs-search-dialog';
import type { SearchResult } from '@tale/ui/search';
import { useCallback } from 'react';

import { searchResultTrail } from '@/lib/content/nav-sections';
import { useT } from '@/lib/i18n/client';
import type { SupportedLocale } from '@/lib/i18n/locales';

const SEARCH_BASE_URL = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
const SECTION_TO_NAV_KEY: Record<string, string> = {
  'get-started': 'start',
  cloud: 'cloud',
  'self-hosted': 'selfHosted',
  platform: 'platform',
  develop: 'develop',
  tutorials: 'tutorials',
  legal: 'legal',
};

/** One search index, route vocabulary and history across both docs shells. */
export function useDocsSearchConfig(locale: SupportedLocale): DocsSearchConfig {
  const { t } = useT('nav');
  const sectionLabel = useCallback(
    (key: string) => {
      const navKey = SECTION_TO_NAV_KEY[key];
      return navKey
        ? t(`groups.${navKey}`)
        : key.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
    },
    [t],
  );
  const breadcrumb = useCallback(
    (result: SearchResult) => searchResultTrail(result.id, (key) => t(key)),
    [t],
  );
  return {
    indexUrl: `${SEARCH_BASE_URL}/search-index-${locale}.json`,
    recentsStorageKey: 'tale.docs.recentSearches.v1',
    sectionLabel,
    breadcrumb,
  };
}
