'use client';

import { Button } from '@tale/ui/button';
import { Tooltip } from '@tale/ui/tooltip';
import { useSearchShortcut } from '@tale/ui/use-search-shortcut';
import { Search } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useOptionalSidebar } from './sidebar-context';
import { TOOLTIP_SHORTCUT_CLASS } from './sidebar-motion';

export interface SidebarSearchTriggerProps {
  className?: string;
}

/**
 * Opens the shared search palette on Everything (⌘K / Ctrl+K) — from the
 * rail on a computer, and from the Home screen's header on a phone.
 */
export function SidebarSearchTrigger({ className }: SidebarSearchTriggerProps) {
  const sidebar = useOptionalSidebar();
  const { t: tNav } = useT('navigation');
  const shortcut = useSearchShortcut();

  if (!sidebar) return null;

  const label = tNav('sidebar.searchGlobal');
  const ariaLabel = tNav('sidebar.search');

  const tooltip = (
    <>
      {label}
      <span className={TOOLTIP_SHORTCUT_CLASS}>{shortcut}</span>
    </>
  );

  return (
    <Tooltip content={tooltip} side="right">
      <Button
        type="button"
        variant="ghost"
        onClick={() => sidebar.openSearch('everything')}
        aria-label={ariaLabel}
        aria-keyshortcuts={shortcut}
        className={
          className ??
          'text-muted-foreground hover:bg-muted/60 hover:text-foreground flex size-9 items-center justify-center rounded-md p-0'
        }
      >
        <Search className="size-5 shrink-0" />
      </Button>
    </Tooltip>
  );
}
