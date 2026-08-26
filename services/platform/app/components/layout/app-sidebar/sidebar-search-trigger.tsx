'use client';

import { Button } from '@tale/ui/button';
import { Search } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useSearchShortcut } from '@/app/hooks/use-search-shortcut';
import { useT } from '@/lib/i18n/client';

import { useOptionalSidebar } from './sidebar-context';
import { TOOLTIP_SHORTCUT_CLASS } from './sidebar-motion';

export interface SidebarSearchTriggerProps {
  className?: string;
}

/**
 * Opens the global search palette (⌘K / Ctrl+K). Sidebar rail and mobile menu
 * only — context pages use inline search or their own scoped palette.
 */
export function SidebarSearchTrigger({ className }: SidebarSearchTriggerProps) {
  const sidebar = useOptionalSidebar();
  const { t: tNav } = useT('navigation');
  const shortcut = useSearchShortcut();

  if (!sidebar) return null;

  const label = tNav('sidebar.searchGlobal');

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
        onClick={() => sidebar.setSearchOpen(true)}
        aria-label={label}
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
