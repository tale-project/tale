'use client';

import { Description } from '@tale/ui/description';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface PageActionHeaderProps {
  title?: ReactNode;
  description?: ReactNode;
  /**
   * Right-aligned slot, typically `<EditorActions>`. The wrapper reserves
   * min-width so the layout doesn't shift between empty/loading/loaded
   * action states.
   */
  actions?: ReactNode;
  className?: string;
}

/**
 * Page-level header strip for non-tabbed editor pages outside the settings
 * area (settings pages carry no page header; their Save/Discard cluster lives
 * in the settings layout header). Mirrors
 * `TabNavigation`'s height + border so transitioning between tabbed and
 * non-tabbed editors doesn't bounce the layout.
 */
export function PageActionHeader({
  title,
  description,
  actions,
  className,
}: PageActionHeaderProps) {
  return (
    <div
      className={cn(
        'border-border bg-background flex min-h-13 items-center gap-3 border-b px-4',
        className,
      )}
    >
      {(title || description) && (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {title && (
            <span className="text-foreground truncate text-sm font-medium">
              {title}
            </span>
          )}
          {description && (
            <Description muted className="truncate">
              {description}
            </Description>
          )}
        </div>
      )}
      {actions && (
        <div className="ml-auto flex min-w-[160px] items-center justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}
