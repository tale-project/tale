'use client';

import { TaleLogo } from '@tale/ui/logo';
import { SubPanel } from '@tale/ui/sub-panel';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import type { DocsNavGroup } from './docs-nav';
import { DocsNavTree } from './docs-nav-tree';
import { DocsSearchTrigger } from './docs-search-trigger';

export interface DocsNavRailProps {
  /** Top-level groups, rendered as the rail's sections. */
  sections: readonly DocsNavGroup[];
  /** Route of the page on screen; drives the row treatment. */
  activeHref: string;
  /** Where the logo leads. */
  homeHref: string;
  /** Accessible name of the logo link, e.g. "Tale documentation home". */
  homeLabel: string;
  /** Accessible name of the navigation landmark, e.g. "Documentation". */
  navLabel: string;
  /** Open the search palette. */
  onOpenSearch: () => void;
}

/**
 * The documentation rail — the app's `SubPanel` in its navigation role, one
 * viewport tall and pinned beside the article. Its top row carries the logo
 * in the same `h-13` bar as the article's header strip, border included, so
 * the two bottom borders meet as a single line across the viewport. Hidden
 * below `md`, where the same tree is reached through the drawer.
 */
export function DocsNavRail({
  sections,
  activeHref,
  homeHref,
  homeLabel,
  navLabel,
  onOpenSearch,
}: DocsNavRailProps) {
  const activeRef = useRef<HTMLLIElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Bring the active row into view on first paint so a deep page isn't parked
  // below the fold of a long tree. Only on mount: later route changes scroll
  // the page, not the rail.
  useEffect(() => {
    const el = activeRef.current;
    const container = scrollRef.current;
    if (!el || !container) return;
    // Scroll only the rail. scrollIntoView also changes Chromium's sequential
    // focus starting point, which would make the first Tab skip the skip link.
    const row = el.getBoundingClientRect();
    const viewport = container.getBoundingClientRect();
    if (row.bottom > viewport.bottom)
      container.scrollTop += row.bottom - viewport.bottom;
    else if (row.top < viewport.top)
      container.scrollTop += row.top - viewport.top;
  }, []);

  return (
    <SubPanel
      as="nav"
      width="wide"
      ariaLabel={navLabel}
      className="sticky top-0 h-screen print:hidden"
    >
      <div className="border-border flex h-13 shrink-0 items-center border-b px-3">
        <Link
          to={homeHref}
          // Exact: a locale home (`/de`) prefixes every page under it, and an
          // active router link claims `aria-current="page"` by itself.
          activeOptions={{ exact: true }}
          aria-label={homeLabel}
          className="text-foreground focus-visible:ring-ring inline-flex items-center rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <TaleLogo />
        </Link>
      </div>
      <div className="shrink-0 px-3 pt-3">
        <DocsSearchTrigger onClick={onOpenSearch} />
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <DocsNavTree
          sections={sections}
          activeHref={activeHref}
          activeRef={activeRef}
        />
      </div>
    </SubPanel>
  );
}
