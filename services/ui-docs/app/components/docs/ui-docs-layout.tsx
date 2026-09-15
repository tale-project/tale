import { DocsLayout } from '@tale/ui/docs/docs-layout';
import type { SearchResult } from '@tale/ui/search';
import { type ReactNode, useCallback, useMemo } from 'react';

import { navSections, searchResultTrail } from '@/lib/content/nav-sections';
import { useT } from '@/lib/i18n/client';
import { TALE_REPO_URL } from '@/lib/site-url';

// Deploy mount point (Vite's BASE_URL, always trailing-slashed). The search
// index is a static asset served beneath it, so fetching it bare at a sub-path
// deploy would hit the parent app's SPA fallback and return HTML instead of
// JSON.
const BASE_URL = import.meta.env.BASE_URL ?? '/';
const SEARCH_INDEX_URL = `${BASE_URL.replace(/\/$/, '')}/search-index.json`;

/** Slug section key → the `nav.groups` key that names it. */
const SECTION_TO_NAV_KEY: Record<string, string> = {
  'getting-started': 'gettingStarted',
  foundations: 'foundations',
  components: 'components',
  patterns: 'patterns',
  'marketing-ui': 'marketingUi',
};

interface UiDocsLayoutProps {
  /** Route of the page on screen; drives the rail's row treatment. */
  activeHref: string;
  /** The page: its header strip, then its article (or the not-found). */
  children: ReactNode;
}

/**
 * The documentation frame for every page under `/docs` — the shared
 * `@tale/ui` docs layout the product docs render too, fed this site's
 * navigation tree, search index and footer copy. The front page keeps its
 * marketing chrome; the logo leads back to it.
 */
export function UiDocsLayout({ activeHref, children }: UiDocsLayoutProps) {
  const { t: tNav } = useT('nav');
  const { t: tFooter } = useT('footer');

  const sections = useMemo(() => navSections((key) => tNav(key)), [tNav]);

  const sectionLabel = useCallback(
    (key: string) => {
      const navKey = SECTION_TO_NAV_KEY[key];
      if (!navKey)
        return key.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
      return tNav(`groups.${navKey}`);
    },
    [tNav],
  );

  const breadcrumb = useCallback(
    (result: SearchResult) => searchResultTrail(result.id, (key) => tNav(key)),
    [tNav],
  );

  return (
    <DocsLayout
      sections={sections}
      activeHref={activeHref}
      homeHref="/"
      homeLabel={tNav('homeAriaLabel')}
      navLabel={tNav('sidebarAriaLabel')}
      search={{
        indexUrl: SEARCH_INDEX_URL,
        recentsStorageKey: 'tale.ui-docs.recentSearches.v1',
        sectionLabel,
        breadcrumb,
      }}
      footer={{
        legalLines: [
          tFooter('copyrightLine1', { year: new Date().getFullYear() }),
          tFooter('copyrightLine2'),
        ],
        baseUrl: BASE_URL,
        repositoryUrl: TALE_REPO_URL,
      }}
    >
      {children}
    </DocsLayout>
  );
}
