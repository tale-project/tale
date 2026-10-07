import { DocsLayout } from '@tale/ui/docs/docs-layout';
import { LocaleSync } from '@tale/ui/i18n/sync';
import { TALE_GITHUB_URL } from '@tale/ui/seo/globals';
import { ThemeAssets } from '@tale/ui/theme/assets';
import { useSiteCopyright } from '@tale/ui/use-site-copyright';
import {
  createRootRoute,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { useMemo } from 'react';

import { SwUpdateBanner } from '@/app/components/docs/sw-update-banner';
import { firstNavSlug } from '@/lib/content/nav';
import { navSections } from '@/lib/content/nav-sections';
import { docPath } from '@/lib/content/paths';
import { useDocsSearchConfig } from '@/lib/content/use-docs-search-config';
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
  if (segments.length === 0) return firstNavSlug();
  return segments.join('/');
}

function localeFromPathname(pathname: string): SupportedLocale {
  return detectInitialLocale(pathname);
}

/**
 * Every route uses the shared `@tale/ui` documentation frame, fed this
 * site's navigation tree, search index and footer copy.
 */
function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const locale = localeFromPathname(pathname);
  const { t: tNav } = useT('nav');
  const copyright = useSiteCopyright();
  const search = useDocsSearchConfig(locale);

  const sections = useMemo(
    () => navSections(locale, (key) => tNav(key)),
    [locale, tNav],
  );

  if (isSpecialEndpoint(pathname)) {
    // SSR: special endpoints render their own bare body (text/markdown,
    // text/plain, application/xml). The chrome would only get in the way.
    return <Outlet />;
  }

  return (
    <>
      <LocaleSync locale={resolveRegionalLocale(locale)} htmlLang={locale} />
      <ThemeAssets />
      <DocsLayout
        sections={sections}
        activeHref={docPath(locale, activeSlugFromPathname(pathname))}
        homeHref={docPath(locale, firstNavSlug())}
        homeLabel={tNav('homeAriaLabel')}
        navLabel={tNav('sidebarAriaLabel')}
        search={search}
        footer={{
          legalLines: [copyright],
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
