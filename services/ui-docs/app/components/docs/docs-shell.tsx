import type { HeaderBreadcrumbCrumb } from '@tale/ui/header-breadcrumbs';
import type { TocEntry } from '@tale/ui/markdown/extract-toc';
import { SkipLink } from '@tale/ui/skip-link';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { DocsHeader } from '@/app/components/docs/docs-header';
import { DocsMobileNav } from '@/app/components/docs/docs-mobile-nav';
import { DocsNavRail } from '@/app/components/docs/docs-nav-rail';
import { DocsToc } from '@/app/components/docs/docs-toc';
import { useT } from '@/lib/i18n/client';

// Lazy: the palette (framer-motion + the `@tale/ui` search module +
// MiniSearch) is only needed once a reader opens search, so it stays off the
// initial route bundle. Mounted on first open and kept mounted thereafter so
// the close animation still runs.
const SearchDialog = lazy(() =>
  import('@/app/features/search/dialog').then((m) => ({
    default: m.SearchDialog,
  })),
);

// Deploy mount point (Vite's BASE_URL, always trailing-slashed) without the
// trailing slash. The search index is a static asset served beneath this
// prefix, so fetching it bare at a sub-path deploy would hit the parent app's
// SPA fallback and return HTML instead of JSON.
const SEARCH_BASE_URL = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

/** Slug section key → the `nav.groups` key that names it. */
const SECTION_TO_NAV_KEY: Record<string, string> = {
  'getting-started': 'gettingStarted',
  foundations: 'foundations',
  components: 'components',
  patterns: 'patterns',
  'marketing-ui': 'marketingUi',
};

interface DocsShellProps {
  /** Slug of the active page; drives the rail's row treatment. */
  activeSlug: string;
  /** Ancestor trail rendered in the header strip. */
  crumbs: readonly HeaderBreadcrumbCrumb[];
  /** Page title — the page's only `h1`, rendered by the header strip. */
  title: string;
  /** Outline for the right rail. Pass `[]` to hide it. */
  toc: TocEntry[];
  children: ReactNode;
}

/**
 * The documentation chrome, in the PLATFORM design language: a permanent
 * navigation rail, the `h-13` header strip, the article column and the
 * "On this page" outline — every piece built from `@tale/ui`, light and dark.
 *
 * Deliberately props-driven (nav tree in, active slug in) and local to this
 * service: when the shared docs chrome lands in `@tale/ui`, this file is the
 * seam that gets replaced, and nothing above it has to move.
 */
export function DocsShell({
  activeSlug,
  crumbs,
  title,
  toc,
  children,
}: DocsShellProps) {
  const { t } = useT('nav');
  const [searchOpen, setSearchOpen] = useState(false);
  // Mount the lazy palette on first open and keep it mounted so its close
  // animation can play.
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

  const sectionLabel = useCallback(
    (key: string) => {
      const navKey = SECTION_TO_NAV_KEY[key];
      if (!navKey)
        return key.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
      return t(`groups.${navKey}`);
    },
    [t],
  );

  return (
    <div className="bg-background text-foreground flex min-h-screen">
      <SkipLink>{t('skipToMain')}</SkipLink>
      <DocsNavRail activeSlug={activeSlug} onOpenSearch={openSearch} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DocsMobileNav activeSlug={activeSlug} onOpenSearch={openSearch} />
        <DocsHeader crumbs={crumbs} title={title} onOpenSearch={openSearch} />
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-[1100px] min-w-0 flex-1 gap-8 px-4 py-8 sm:px-6 lg:px-8"
        >
          <article className="min-w-0 flex-1">{children}</article>
          <DocsToc entries={toc} />
        </main>
      </div>
      {searchMounted ? (
        <Suspense fallback={null}>
          <SearchDialog
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
