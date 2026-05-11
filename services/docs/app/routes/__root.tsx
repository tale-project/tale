import { LocaleSync } from '@tale/ui/i18n/sync';
import { ThemeAssetSync, useTheme } from '@tale/ui/theme';
import { SkipLink } from '@tale/webui/layout/skip-link';
import { SearchDialog } from '@tale/webui/search/dialog';
import {
  createRootRoute,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DocsFooter } from '@/app/components/docs/docs-footer';
import { DocsHeader } from '@/app/components/docs/docs-header';
import { DocsSidebar } from '@/app/components/docs/docs-sidebar';
import { ScrollToTop } from '@/app/components/docs/scroll-to-top';
import { useT } from '@/lib/i18n/client';
import {
  detectInitialLocale,
  resolveRegionalLocale,
  type SupportedLocale,
} from '@/lib/i18n/locales';

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
  const locale = localeFromPathname(pathname);
  const { resolvedTheme } = useTheme();
  const { t: tNav } = useT('nav');
  const { t: tSearch } = useT('search');

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

  const searchLabels = useMemo(
    () => ({
      title: tSearch('title'),
      placeholder: tSearch('placeholder'),
      empty: tSearch('empty'),
      emptyHint: tSearch('emptyHint'),
      keepTyping: tSearch('keepTyping'),
      noResultsTitle: tSearch('noResultsTitle'),
      noResultsHint: tSearch('noResultsHint'),
      loading: tSearch('loading'),
      close: tSearch('close'),
      recent: tSearch('recent'),
      clearRecent: tSearch('clearRecent'),
      removeRecent: tSearch('removeRecent'),
      tipsTitle: tSearch('tipsTitle'),
      tipNavigate: tSearch('tipNavigate'),
      tipSelect: tSearch('tipSelect'),
      tipClose: tSearch('tipClose'),
      resultCount: (count: number) => tSearch('results', { count }),
    }),
    [tSearch],
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
      <SearchDialog
        locale={locale}
        open={searchOpen}
        onOpenChange={setSearchOpen}
        labels={searchLabels}
        sectionLabel={sectionLabel}
      />
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
