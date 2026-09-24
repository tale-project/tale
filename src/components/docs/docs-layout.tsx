'use client';

import { useT } from '@tale/ui/i18n/client';
import { SkipLink } from '@tale/ui/skip-link';
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from 'react';

import { DocsFooter, type DocsFooterProps } from './docs-footer';
import { DocsMobileNav } from './docs-mobile-nav';
import type { DocsNavGroup } from './docs-nav';
import { DocsNavRail } from './docs-nav-rail';
import type { DocsSearchConfig } from './docs-search-dialog';
import { ScrollToTop } from './scroll-to-top';

// Lazy: the palette (framer-motion + the search family + MiniSearch) is only
// needed once a reader opens search (⌘K), so it stays off the initial route
// bundle. Mounted on first open and kept mounted thereafter so its close
// animation still runs.
const DocsSearchDialog = lazy(() =>
  import('./docs-search-dialog').then((m) => ({
    default: m.DocsSearchDialog,
  })),
);

export interface DocsLayoutProps {
  /** Top-level navigation groups, rendered as the rail's sections. */
  sections: readonly DocsNavGroup[];
  /** Route of the page on screen; drives the active row. */
  activeHref: string;
  /** Where the logo leads. */
  homeHref: string;
  /** Accessible name of the logo link, e.g. "Tale documentation home". */
  homeLabel: string;
  /** Accessible name of the navigation landmark, e.g. "Documentation". */
  navLabel: string;
  search: DocsSearchConfig;
  footer: DocsFooterProps;
  /** The page: a `DocsHeader` strip, then its `DocsArticle` (or a
   *  `DocsNotFound`). */
  children: ReactNode;
}

/**
 * The documentation frame, in the app's detail-page anatomy: a permanent
 * `SubPanel` rail on the left (the phone reaches the same tree through the
 * drawer in `DocsMobileNav`), and a single window-scrolling column holding
 * the page's header strip, the article and the compact footer. The page
 * owns its own header strip, so a route can render the trail and the
 * actions that belong to it. ⌘K / Ctrl+K toggles the search palette.
 *
 * Every documentation site renders this frame — the product docs and the
 * design-system guide — so a fix to the chrome lands on both at once.
 */
export function DocsLayout({
  sections,
  activeHref,
  homeHref,
  homeLabel,
  navLabel,
  search,
  footer,
  children,
}: DocsLayoutProps) {
  const { t } = useT('docs');
  const [searchOpen, setSearchOpen] = useState(false);
  // Mount the lazy palette on first open and keep it mounted so its close
  // animation can still play.
  const [searchMounted, setSearchMounted] = useState(false);
  useEffect(() => {
    if (searchOpen) setSearchMounted(true);
  }, [searchOpen]);

  // ⌘K / Ctrl+K toggles the palette.
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

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const navProps = {
    sections,
    activeHref,
    homeHref,
    homeLabel,
    navLabel,
    onOpenSearch: openSearch,
  };

  return (
    <div className="bg-background text-foreground flex min-h-screen">
      <SkipLink>{t('skipToMain')}</SkipLink>
      <DocsNavRail {...navProps} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DocsMobileNav {...navProps} />
        <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col">
          {children}
        </main>
        <DocsFooter {...footer} />
      </div>
      <ScrollToTop />
      {searchMounted ? (
        <Suspense fallback={null}>
          <DocsSearchDialog
            {...search}
            open={searchOpen}
            onOpenChange={setSearchOpen}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
