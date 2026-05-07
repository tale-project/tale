import { SkipLink } from '@tale/webui/layout/skip-link';
import { SearchDialog } from '@tale/webui/search/dialog';
import {
  createRootRoute,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { DocsFooter } from '@/app/components/docs/docs-footer';
import { DocsHeader } from '@/app/components/docs/docs-header';
import { DocsSidebar } from '@/app/components/docs/docs-sidebar';
import { i18n } from '@/lib/i18n/i18n';
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

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [searchOpen, setSearchOpen] = useState(false);
  const locale = localeFromPathname(pathname);

  // Sync i18next language to the active locale on every route change.
  useEffect(() => {
    void i18n.changeLanguage(resolveRegionalLocale(locale));
  }, [locale]);

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

  if (isSpecialEndpoint(pathname)) {
    // SSR: special endpoints render their own bare body (text/markdown,
    // text/plain, application/xml). The chrome would only get in the way.
    return <Outlet />;
  }

  const activeSlug = activeSlugFromPathname(pathname);

  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink>Skip to main content</SkipLink>
      <DocsHeader locale={locale} onOpenSearch={() => setSearchOpen(true)} />
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 px-5 md:px-8">
        <DocsSidebar locale={locale} activeSlug={activeSlug} />
        <main
          id="main"
          className="min-w-0 flex-1 px-0 py-10 lg:px-8 xl:flex xl:gap-10"
        >
          <article className="min-w-0 flex-1">
            <Outlet />
          </article>
        </main>
      </div>
      <DocsFooter />
      <SearchDialog
        locale={locale}
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
