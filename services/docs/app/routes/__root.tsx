import { DocsLayout } from '@tale/ui/docs/docs-layout';
import { LocaleSync } from '@tale/ui/i18n/sync';
import type { SearchResult } from '@tale/ui/search';
import { TALE_GITHUB_URL } from '@tale/ui/seo/globals';
import { ThemeAssetSync, useTheme } from '@tale/ui/theme';
import {
  createRootRoute,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { SwUpdateBanner } from '@/app/components/docs/sw-update-banner';
import { navSections, searchResultTrail } from '@/lib/content/nav-sections';
import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import {
  detectInitialLocale,
  resolveRegionalLocale,
  type SupportedLocale,
} from '@/lib/i18n/locales';

// Deploy mount-point (Vite's BASE_URL, always trailing-slashed) without the
// trailing slash — `''` at root, `/docs` under a sub-path. The search index is
// a static asset served beneath this prefix, so fetching it bare (`/search-
// index-de.json`) at a sub-path deploy hits the parent app's SPA fallback and
// returns HTML instead of JSON.
const BASE_URL = import.meta.env.BASE_URL ?? '/';
const SEARCH_BASE_URL = BASE_URL.replace(/\/$/, '');

function isSpecialEndpoint(pathname: string): boolean {
  return (
    pathname.endsWith('.md') ||
    pathname === '/llms.txt' ||
    pathname === '/llms-full.txt' ||
    pathname === '/sitemap.xml' ||
    pathname === '/robots.txt'
  );
}

function activeSlugFromPathname(pathname: string): string {
  const segments = pathname.split('/').filter((s) => s.length > 0);
  if (segments[0] === 'de' || segments[0] === 'fr') segments.shift();
  if (segments.length === 0) return 'index';
  return segments.join('/');
}

function localeFromPathname(pathname: string): SupportedLocale {
  return detectInitialLocale(pathname);
}

/** Slug-section keys (e.g. "self-hosted") map to camelCase i18n keys
 *  (e.g. "selfHosted") so we can reuse the existing `nav.groups` namespace. */
const SECTION_TO_NAV_KEY: Record<string, string> = {
  'get-started': 'start',
  cloud: 'cloud',
  'self-hosted': 'selfHosted',
  platform: 'platform',
  develop: 'develop',
  tutorials: 'tutorials',
  legal: 'legal',
};

/**
 * The docs shell: the shared `@tale/ui` documentation frame around every
 * route, fed this site's navigation tree, search index and footer copy. The
 * page owns its own header strip, so a route can render the trail and the
 * actions that belong to it.
 */
function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const locale = localeFromPathname(pathname);
  const { resolvedTheme } = useTheme();
  const { t: tNav } = useT('nav');
  const { t: tFooter } = useT('footer');

  const sections = useMemo(
    () => navSections(locale, (key) => tNav(key)),
    [locale, tNav],
  );

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

  if (isSpecialEndpoint(pathname)) {
    // SSR: special endpoints render their own bare body (text/markdown,
    // text/plain, application/xml). The chrome would only get in the way.
    return <Outlet />;
  }

  return (
    <>
      <LocaleSync locale={resolveRegionalLocale(locale)} htmlLang={locale} />
      <ThemeAssetSync resolvedTheme={resolvedTheme} />
      <DocsLayout
        sections={sections}
        activeHref={docPath(locale, activeSlugFromPathname(pathname))}
        homeHref={docPath(locale, 'index')}
        homeLabel={tNav('homeAriaLabel')}
        navLabel={tNav('sidebarAriaLabel')}
        search={{
          indexUrl: `${SEARCH_BASE_URL}/search-index-${locale}.json`,
          recentsStorageKey: 'tale.docs.recentSearches.v1',
          sectionLabel,
          breadcrumb,
        }}
        footer={{
          legalLines: [
            tFooter('copyrightLine1', { year: new Date().getFullYear() }),
            tFooter('copyrightLine2'),
          ],
          baseUrl: BASE_URL,
          repositoryUrl: TALE_GITHUB_URL,
          showLanguageSwitcher: true,
        }}
      >
        <Outlet />
      </DocsLayout>
      <SwUpdateBanner />
    </>
  );
}

export const Route = createRootRoute({ component: RootLayout });
