'use client';

import { type LucideIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export interface DataTableEmptyStateProps {
  /** Icon to display */
  icon?: LucideIcon;
  /** Title text */
  title: string;
  /** Description text */
  description?: string;
  /** Action button or element */
  action?: ReactNode;
  /** Additional class name */
  className?: string;
  /** Whether this is a "no results" state (filters applied but no matches) */
  isFiltered?: boolean;
  /** Custom content to render instead of default layout */
  children?: ReactNode;
}

/**
 * Unified empty state component for DataTable.
 * 
 * Supports two modes:
 * 1. Initial empty state - when there's no data at all (shows icon + CTA)
 * 2. Filtered empty state - when filters are applied but no results match
 */
export function DataTableEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  isFiltered = false,
  children,
}: DataTableEmptyStateProps) {
  if (children) {
    return (
      <div
        className={cn(
          'grid place-items-center flex-[1_1_0] ring-1 ring-border rounded-xl p-4',
          className,
        )}
      >
        {children}
      </div>
    );
  }

  if (isFiltered) {
    return (
      <div
        className={cn(
          'flex items-center justify-center py-16 px-4 text-center',
          className,
        )}
      >
        <div className="space-y-2">
          <h4 className="text-base font-semibold text-foreground">{title}</h4>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
          {action}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'grid place-items-center flex-[1_1_0] ring-1 ring-border rounded-xl p-4',
        className,
      )}
    >
      <div className="text-center max-w-[24rem] flex flex-col items-center">
        {Icon && <Icon className="size-6 text-secondary mb-5" />}
        <div className="text-lg font-semibold leading-tight mb-2">{title}</div>
        {description && (
          <p className="text-sm text-muted-foreground mb-5">{description}</p>
        )}
        {action}
      </div>
    </div>
  );
}

