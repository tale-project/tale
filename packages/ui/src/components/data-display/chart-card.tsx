'use client';

import { Info } from 'lucide-react';
import { type ComponentType, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { EmptyState } from '../feedback/empty-state';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../overlays/tooltip';

interface ChartCardProps {
  /**
   * Chart title. Omit when the parent already owns the section heading
   * (e.g. a metrics page `MetricsSection`) so the label sits outside the card
   * like sibling tables.
   */
  title?: string;
  /** Optional explainer shown via an info tooltip next to the title. */
  tooltip?: string;
  /** Right-aligned header controls, e.g. a period or metric selector. */
  toolbar?: ReactNode;
  /** Legend rendered below the chart body — typically a `<ChartLegend>`. */
  legend?: ReactNode;
  /** When true, show a placeholder block instead of the chart body. */
  loading?: boolean;
  /** When true (and not loading), show the empty state instead of children. */
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: ComponentType<{ className?: string }>;
  /** The chart itself (e.g. a recharts `ResponsiveContainer`). */
  children: ReactNode;
  /** Classes for the chart body wrapper — set the height here (e.g. `h-60`). */
  bodyClassName?: string;
  className?: string;
}

/**
 * The unified chart container: a bordered card with an optional title + info
 * tooltip, an optional toolbar (period/metric controls), a fixed-height body
 * that swaps between a loading placeholder, an empty state, and the chart, and
 * an optional legend below. Replaces the per-feature `ChartCard` /
 * `ChartCardHeader` reimplementations.
 *
 * Fill matches metrics `DataTable` frames (border only, no `bg-card`) so a
 * chart beside titled table sections doesn't read as a different surface.
 */
export function ChartCard({
  title,
  tooltip,
  toolbar,
  legend,
  loading = false,
  isEmpty = false,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  children,
  bodyClassName = 'h-60',
  className,
}: ChartCardProps) {
  const showHeader = Boolean(title || tooltip || toolbar);

  return (
    <div
      className={cn(
        'border-border flex h-full flex-col gap-4 rounded-lg border p-5',
        className,
      )}
    >
      {showHeader ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {title ? (
              <h3 className="text-foreground truncate text-sm font-semibold">
                {title}
              </h3>
            ) : null}
            {tooltip ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    aria-label={tooltip}
                    className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-6 shrink-0 items-center justify-center rounded focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Info className="size-4" aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent side="top">{tooltip}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>
          {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
        </div>
      ) : null}

      <div className={cn('w-full', bodyClassName)}>
        {loading ? (
          <div
            className="bg-muted size-full animate-pulse rounded-md motion-reduce:animate-none"
            role="status"
            aria-busy
          />
        ) : isEmpty ? (
          <EmptyState
            icon={emptyIcon}
            title={emptyTitle ?? title}
            description={emptyDescription}
          />
        ) : (
          children
        )}
      </div>

      {legend && !loading && !isEmpty ? legend : null}
    </div>
  );
}
