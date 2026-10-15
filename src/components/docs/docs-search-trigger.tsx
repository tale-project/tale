'use client';

import { cn } from '@tale/ui/cn';
import { useT } from '@tale/ui/i18n/client';
import { useSearchShortcut } from '@tale/ui/use-search-shortcut';
import { Search } from 'lucide-react';

interface DocsSearchTriggerProps {
  /** Open the search palette. */
  onClick: () => void;
  className?: string;
}

/**
 * The rail's search affordance: an `h-9` control that opens the ⌘K palette,
 * with a 44px touch target in the phone drawer. Rendered in the rail and in the
 * phone drawer; the phone header bar uses an icon-only `IconButton` instead,
 * where a full-width field would not fit.
 */
export function DocsSearchTrigger({
  onClick,
  className,
}: DocsSearchTriggerProps) {
  const { t } = useT('docs');
  const shortcut = useSearchShortcut();

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('openSearch')}
      className={cn(
        'border-border/80 bg-background text-muted-foreground hover:border-border-strong hover:bg-muted/40 hover:text-foreground focus-visible:ring-ring flex h-11 w-full items-center gap-2.5 rounded-lg border px-3 text-[13px] shadow-xs transition-colors duration-200 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none md:h-9',
        className,
      )}
    >
      <Search aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">
        {t('searchPlaceholder')}
      </span>
      <kbd className="border-border/80 bg-muted/30 text-muted-foreground hidden shrink-0 rounded border px-1 py-0.5 font-mono text-[10px] sm:inline">
        {shortcut}
      </kbd>
    </button>
  );
}
