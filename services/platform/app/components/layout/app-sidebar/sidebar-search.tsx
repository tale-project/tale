'use client';

import { Search } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useIsMac } from '@/app/hooks/use-is-mac';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useSidebar } from './sidebar-context';
import {
  labelFadeClass,
  ROW_TRANSITION_CLASS,
  rowWidthStyle,
  TOOLTIP_SHORTCUT_CLASS,
} from './sidebar-motion';

export interface SidebarSearchProps {
  expanded: boolean;
}

/**
 * The search affordance: expanded it reads as an input row (with the ⌘K hint),
 * collapsed it is one more icon tile — either way it only opens the shared
 * SearchCommand palette; there is no second search implementation. Same
 * `size-5` glyph and 6px inset as the nav rows, so its icon sits on the same
 * column at the same weight.
 */
export function SidebarSearch({ expanded }: SidebarSearchProps) {
  const { setSearchOpen } = useSidebar();
  const { t } = useT('chat');
  const isMac = useIsMac();
  const shortcut = isMac ? '⌘ K' : 'CTRL + K';

  const button = (
    <button
      type="button"
      onClick={() => setSearchOpen(true)}
      aria-label={t('searchChat')}
      className={cn(
        'text-muted-foreground flex h-8 cursor-pointer items-center gap-2.5 overflow-hidden rounded-md border pl-1.5',
        ROW_TRANSITION_CLASS,
        expanded
          ? 'border-border bg-muted/50 hover:bg-muted pr-1.5'
          : 'hover:bg-muted hover:text-foreground border-transparent',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none',
      )}
      style={rowWidthStyle(expanded)}
    >
      <Search className="size-5 shrink-0" />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-left text-[13px]',
          labelFadeClass(expanded),
        )}
      >
        {t('searchChat')}
      </span>
      <kbd
        className={cn(
          'border-border bg-background text-muted-foreground shrink-0 rounded border px-1 font-sans text-[10px]',
          labelFadeClass(expanded),
        )}
      >
        {shortcut}
      </kbd>
    </button>
  );

  if (expanded) return button;

  return (
    <Tooltip
      content={
        <>
          {t('searchChat')}
          <span className={TOOLTIP_SHORTCUT_CLASS}>{shortcut}</span>
        </>
      }
      side="right"
      contentClassName="py-1.5"
    >
      {button}
    </Tooltip>
  );
}
