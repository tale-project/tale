'use client';

import { Button } from '@tale/ui/button';
import { useT } from '@tale/ui/i18n/client';
import { IconButton } from '@tale/ui/icon-button';
import { TaleLogo } from '@tale/ui/logo';
import { MobileAppHeader } from '@tale/ui/mobile-app-header';
import { Sheet } from '@tale/ui/sheet';
import { useIsMobile } from '@tale/ui/use-is-mobile';
import { Menu, Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DocsAncestorLink } from './docs-ancestor-link';
import type { DocsNavRailProps } from './docs-nav-rail';
import { DocsNavTree } from './docs-nav-tree';
import { DocsSearchTrigger } from './docs-search-trigger';

export type DocsMobileNavProps = DocsNavRailProps;

const LOGO_LINK_CLASS =
  'text-foreground focus-visible:ring-ring inline-flex items-center rounded-sm focus-visible:ring-2 focus-visible:outline-none';

/**
 * The phone chrome: the app's `MobileAppHeader` bar (menu · logo · search)
 * plus the rail as a left `Sheet`. The drawer carries the same search trigger
 * and the same nav tree as the desktop rail, and closes itself when a page is
 * chosen. Hidden from `md` up, where the rail is permanent.
 */
export function DocsMobileNav({
  sections,
  activeHref,
  homeHref,
  homeLabel,
  navLabel,
  onOpenSearch,
}: DocsMobileNavProps) {
  const { t } = useT('docs');
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isMobile = useIsMobile();

  // A `Sheet`'s `md:hidden` hides its PANEL, not the overlay Radix portals —
  // a drawer left open while the viewport grows past `md` (a rotation, a
  // resized window) would dim the page and swallow every click behind an
  // invisible scrim. Close it at the breakpoint instead.
  useEffect(() => {
    if (!isMobile) setOpen(false);
  }, [isMobile]);

  // The drawer is state-driven rather than wrapped in a Radix `Dialog.Trigger`
  // (the header bar owns the button), so nothing restores focus when it
  // closes — a keyboard reader would land on `<body>`. Put focus back on the
  // menu button once the exit animation has released the focus trap.
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) return;
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);
  const close = useCallback(() => handleOpenChange(false), [handleOpenChange]);
  const openSearchFromDrawer = useCallback(() => {
    setOpen(false);
    onOpenSearch();
  }, [onOpenSearch]);

  return (
    <>
      <MobileAppHeader
        className="border-border/70 print:hidden"
        start={
          <IconButton
            ref={triggerRef}
            icon={Menu}
            className="size-11"
            aria-label={t('openMenu')}
            aria-expanded={open}
            onClick={() => setOpen(true)}
          />
        }
        end={
          <IconButton
            icon={Search}
            className="size-11"
            aria-label={t('openSearch')}
            onClick={onOpenSearch}
          />
        }
      >
        <DocsAncestorLink
          to={homeHref}
          activeOptions={{ exact: true }}
          aria-label={homeLabel}
          className={LOGO_LINK_CLASS}
        >
          <TaleLogo />
        </DocsAncestorLink>
      </MobileAppHeader>
      <Sheet
        open={open && isMobile}
        onOpenChange={handleOpenChange}
        side="left"
        title={navLabel}
        hideClose
        className="bg-background flex w-[min(100vw,20rem)] flex-col gap-0 p-0 md:hidden"
      >
        <div className="border-border/70 flex min-h-13 shrink-0 items-center justify-between gap-2 border-b px-4 pt-(--safe-top)">
          <DocsAncestorLink
            to={homeHref}
            activeOptions={{ exact: true }}
            aria-label={homeLabel}
            onClick={close}
            className={LOGO_LINK_CLASS}
          >
            <TaleLogo />
          </DocsAncestorLink>
          {/* A plain Button, not an IconButton: the IconButton's automatic
              hover/focus tooltip would open the moment the drawer focuses its
              close control, and a Radix tooltip layer swallows the first
              Escape — so the drawer would need two presses to dismiss. */}
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            icon={X}
            iconClassName="text-muted-foreground"
            aria-label={t('closeMenu')}
            onClick={close}
          />
        </div>
        <div className="shrink-0 px-4 pt-4">
          <DocsSearchTrigger onClick={openSearchFromDrawer} />
        </div>
        <nav
          aria-label={navLabel}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-[max(1.25rem,var(--safe-bottom))]"
        >
          <DocsNavTree
            sections={sections}
            activeHref={activeHref}
            onNavigate={close}
          />
        </nav>
      </Sheet>
    </>
  );
}
