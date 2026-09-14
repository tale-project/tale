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
import { DocsMobileNav } from '@/app/components/docs/docs-mobile-nav';
import { DocsNavRail } from '@/app/components/docs/docs-nav-rail';
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
  'get-started': 'start',
  cloud: 'cloud',
  'self-hosted': 'selfHosted',
  platform: 'platform',
  develop: 'develop',
  tutorials: 'tutorials',
  legal: 'legal',
};

/**
 * The docs shell, in the app's detail-page anatomy: a permanent `SubPanel`
 * rail on the left (the phone reaches the same tree through the drawer in
 * `DocsMobileNav`), and a single scrolling column holding the page's header
 * strip, the article and the compact footer. The page owns its own header
 * strip, so a route can render the trail and the actions that belong to it.
 */
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
  const openSearch = useCallback(() => setSearchOpen(true), []);

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
    <div className="bg-background text-foreground flex min-h-screen">
      <LocaleSync locale={resolveRegionalLocale(locale)} htmlLang={locale} />
      <ThemeAssetSync resolvedTheme={resolvedTheme} />
      <SkipLink>{tNav('skipToMain')}</SkipLink>
      <DocsNavRail
        locale={locale}
        activeSlug={activeSlug}
        onOpenSearch={openSearch}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <DocsMobileNav
          locale={locale}
          activeSlug={activeSlug}
          onOpenSearch={openSearch}
        />
        <main id="main" className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </main>
        <DocsFooter />
      </div>
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
