'use client';

import { type ReactNode } from 'react';

import { cn } from '../../lib/cn';

export interface ChartLegendItem {
  /** Series name. */
  label: string;
  /** Swatch color — a `var(--color-chart-*)` token from chart-theme. */
  color: string;
  /** Optional trailing value, e.g. a count. */
  value?: ReactNode;
}

interface ChartLegendProps {
  items: ChartLegendItem[];
  /** Alignment of the legend row. */
  align?: 'center' | 'start';
  className?: string;
}

/**
 * The shared chart legend row — a swatch + label (+ optional value) per series.
 * Previously re-implemented inline in every chart; centralized here so swatch
 * shape, spacing, and muted-label treatment stay consistent.
 */
export function ChartLegend({
  items,
  align = 'center',
  className,
}: ChartLegendProps) {
  return (
    <ul
      className={cn(
        'flex flex-wrap gap-x-4 gap-y-1',
        align === 'center' ? 'justify-center' : 'justify-start',
        className,
      )}
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-xs">
          <span
            className="size-3 shrink-0 rounded-[2px]"
            style={{ background: item.color }}
            aria-hidden
          />
          <span className="text-muted-foreground">{item.label}</span>
          {item.value !== undefined ? (
            <span className="text-foreground font-medium tabular-nums">
              {item.value}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
