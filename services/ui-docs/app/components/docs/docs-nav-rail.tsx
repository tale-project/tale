import { TaleLogo } from '@tale/ui/logo';
import { SubPanel } from '@tale/ui/sub-panel';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { DocsNavTree } from '@/app/components/docs/docs-nav-tree';
import { DocsSearchTrigger } from '@/app/components/docs/docs-search-trigger';
import { useT } from '@/lib/i18n/client';

interface DocsNavRailProps {
  /** Slug of the active page; drives the row treatment. */
  activeSlug: string;
  /** Open the search palette. */
  onOpenSearch: () => void;
}

/**
 * The documentation rail — the app's `SubPanel` in its navigation role, one
 * viewport tall and pinned beside the article. Its top row carries the logo
 * at the same `h-13` as the article header, so the two bottom borders meet as
 * a single line across the viewport. Hidden below `md`, where the same tree
 * is reached through the drawer.
 */
export function DocsNavRail({ activeSlug, onOpenSearch }: DocsNavRailProps) {
  const { t } = useT('nav');
  const activeRef = useRef<HTMLLIElement | null>(null);

  // Bring the active row into view on first paint so a deep page isn't parked
  // below the fold of a long tree. Only on mount: later route changes scroll
  // the page, not the rail.
  useEffect(() => {
    const el = activeRef.current;
    if (!el || typeof el.scrollIntoView !== 'function') return;
    el.scrollIntoView({ block: 'nearest' });
  }, []);

  return (
    <SubPanel
      as="nav"
      width="wide"
      ariaLabel={t('sidebarAriaLabel')}
      className="sticky top-0 h-screen"
    >
      <div className="border-border flex h-13 shrink-0 items-center border-b px-3">
        <Link
          to="/"
          aria-label={t('homeAriaLabel')}
          className="text-foreground focus-visible:ring-ring inline-flex items-center rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <TaleLogo />
        </Link>
      </div>
      <div className="shrink-0 px-3 pt-3">
        <DocsSearchTrigger onClick={onOpenSearch} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <DocsNavTree activeSlug={activeSlug} activeRef={activeRef} />
      </div>
    </SubPanel>
  );
}
