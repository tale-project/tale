import { LocaleSync } from '@tale/ui/i18n/sync';
import { SkipLink } from '@tale/ui/skip-link';
import { ThemeAssetSync, useTheme } from '@tale/ui/theme';
import {
  createRootRoute,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';

import { DocsFooter } from '@/app/components/docs/docs-footer';
import { DocsHeader } from '@/app/components/docs/docs-header';
import { DocsSidebar } from '@/app/components/docs/docs-sidebar';
import { ScrollToTop } from '@/app/components/docs/scroll-to-top';
import { SwUpdateBanner } from '@/app/components/docs/sw-update-banner';
import { useT } from '@/lib/i18n/client';
import {
  detectInitialLocale,
  resolveRegionalLocale,
  type SupportedLocale,
} from '@/lib/i18n/locales';

// Lazy-loaded: the search palette (framer-motion + the @tale/ui search module +
// MiniSearch) is only needed once the user opens search (⌘K), so keep it off
// the initial route bundle. Mounted on first open and kept mounted thereafter
// so its open/close animation still runs.
const SearchDialog = lazy(() =>
  import('@/app/features/search/dialog').then((m) => ({
    default: m.SearchDialog,
  })),
);

// Deploy mount-point (Vite's BASE_URL, always trailing-slashed) without the
// trailing slash — `''` at root, `/docs` under a sub-path. The search index is
// a static asset served beneath this prefix, so fetching it bare (`/search-
// index-de.json`) at a sub-path deploy hits the parent app's SPA fallback and
// returns HTML instead of JSON. `client.ts` appends its own leading slash.
const SEARCH_BASE_URL = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

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
  cloud: 'cloud',
  'self-hosted': 'selfHosted',
  platform: 'platform',
  develop: 'develop',
  tutorials: 'tutorials',
};

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [searchOpen, setSearchOpen] = useState(false);
  // Mount the lazy SearchDialog on first open and keep it mounted so its
  // close animation can still play.
  const [searchMounted, setSearchMounted] = useState(false);
  useEffect(() => {
    if (searchOpen) setSearchMounted(true);
  }, [searchOpen]);
  const locale = localeFromPathname(pathname);
  const { resolvedTheme } = useTheme();
  const { t: tNav } = useT('nav');

  // ⌘K / Ctrl+K opens the search dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (
        isMod &&
        !event.shiftKey &&
        !event.altKey &&
        (event.key === 'k' || event.key === 'K')
      ) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const sectionLabel = useCallback(
    (key: string) => {
      const navKey = SECTION_TO_NAV_KEY[key];
      if (!navKey)
        return key.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
      return tNav(`groups.${navKey}`);
    },
    [tNav],
  );

  if (isSpecialEndpoint(pathname)) {
    // SSR: special endpoints render their own bare body (text/markdown,
    // text/plain, application/xml). The chrome would only get in the way.
    return <Outlet />;
  }

  const activeSlug = activeSlugFromPathname(pathname);

  return (
    <div className="bg-bg-base text-fg-base flex min-h-screen flex-col">
      <LocaleSync locale={resolveRegionalLocale(locale)} htmlLang={locale} />
      <ThemeAssetSync resolvedTheme={resolvedTheme} />
      <SkipLink>Skip to main content</SkipLink>
      <DocsHeader
        locale={locale}
        activeSlug={activeSlug}
        onOpenSearch={() => setSearchOpen(true)}
      />
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 px-4 sm:px-5 md:px-8">
        <DocsSidebar locale={locale} activeSlug={activeSlug} />
        <main
          id="main"
          className="min-w-0 flex-1 py-6 sm:py-8 lg:px-8 lg:py-10 xl:flex xl:gap-10"
        >
          <article className="min-w-0 flex-1">
            <Outlet />
          </article>
        </main>
      </div>
      <DocsFooter />
      <ScrollToTop />
      <SwUpdateBanner />
      {searchMounted ? (
        <Suspense fallback={null}>
          <SearchDialog
            locale={locale}
            open={searchOpen}
            onOpenChange={setSearchOpen}
            sectionLabel={sectionLabel}
            baseUrl={SEARCH_BASE_URL}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
