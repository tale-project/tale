import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { TaleLogo } from '@tale/ui/logo';
import { MobileAppHeader } from '@tale/ui/mobile-app-header';
import { Sheet } from '@tale/ui/sheet';
import { useIsMobile } from '@tale/ui/use-is-mobile';
import { Link } from '@tanstack/react-router';
import { Menu, Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DocsNavTree } from '@/app/components/docs/docs-nav-tree';
import { DocsSearchTrigger } from '@/app/components/docs/docs-search-trigger';
import { useT } from '@/lib/i18n/client';

interface DocsMobileNavProps {
  /** Slug of the active page; drives the row treatment in the drawer. */
  activeSlug: string;
  /** Open the search palette. */
  onOpenSearch: () => void;
}

/**
 * The phone chrome: the app's `MobileAppHeader` bar (menu · logo · search)
 * plus the rail as a left `Sheet`. The drawer carries the same search trigger
 * and the same nav tree as the desktop rail, and closes itself when a page is
 * chosen. Hidden from `md` up, where the rail is permanent.
 */
export function DocsMobileNav({
  activeSlug,
  onOpenSearch,
}: DocsMobileNavProps) {
  const { t } = useT('nav');
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
  // menu button once the exit animation has released the trap.
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
        start={
          <IconButton
            ref={triggerRef}
            icon={Menu}
            aria-label={t('openMenu')}
            aria-expanded={open}
            onClick={() => setOpen(true)}
          />
        }
        end={
          <IconButton
            icon={Search}
            aria-label={t('openSearch')}
            onClick={onOpenSearch}
          />
        }
      >
        <Link
          to="/"
          aria-label={t('homeAriaLabel')}
          className="text-foreground focus-visible:ring-ring inline-flex items-center rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <TaleLogo />
        </Link>
      </MobileAppHeader>
      <Sheet
        open={open}
        onOpenChange={handleOpenChange}
        side="left"
        title={t('sidebarAriaLabel')}
        hideClose
        className="flex w-[min(100vw,20rem)] flex-col gap-0 p-0 md:hidden"
      >
        <div className="border-border flex h-13 shrink-0 items-center justify-between gap-2 border-b px-3 pt-(--safe-top)">
          <Link
            to="/"
            aria-label={t('homeAriaLabel')}
            onClick={close}
            className="text-foreground focus-visible:ring-ring inline-flex items-center rounded-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            <TaleLogo />
          </Link>
          {/* A plain Button, not an IconButton: the IconButton's automatic
              hover/focus tooltip would open the moment the drawer focuses its
              close control, and a Radix tooltip layer swallows the first
              Escape — so the drawer would need two presses to dismiss. */}
          <Button
            variant="ghost"
            size="icon"
            icon={X}
            iconClassName="text-muted-foreground"
            aria-label={t('closeMenu')}
            onClick={close}
          />
        </div>
        <div className="shrink-0 px-3 pt-3">
          <DocsSearchTrigger onClick={openSearchFromDrawer} />
        </div>
        <nav
          aria-label={t('sidebarAriaLabel')}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-4 pb-(--safe-bottom)"
        >
          <DocsNavTree activeSlug={activeSlug} onNavigate={close} />
        </nav>
      </Sheet>
    </>
  );
}
