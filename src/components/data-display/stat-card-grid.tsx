'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { SkeletonBox } from '../feedback/skeleton';
import { useSkeleton } from '../feedback/skeleton-context';
import { Text } from '../typography/text';

/**
 * StatCardGrid / StatCard — the bordered, divided strip of headline metrics used
 * across analytics and audit summaries (total requests, success rate, …). One
 * presentational primitive replacing four hand-rolled copies; pass already
 * formatted/translated `label`/`value` strings (no i18n inside).
 *
 * Distinct from `@tale/ui/stat-grid` (a borderless `<dl>` of label/value pairs).
 * Each `StatCard` masks its value to its own line box while a surrounding
 * `<Skeletonize loading>` is active, so the strip's height is identical loading
 * vs loaded.
 *
 * Dividers are a 1px `gap` painted by the grid's border-colored background —
 * that keeps vertical and horizontal rules full-length across wrapped rows,
 * which Tailwind `divide-*` cannot do (sibling borders only span each cell).
 * Prefer a column count that fills every row; a short last row leaves empty
 * tracks showing the divider color.
 *
 * Columns answer to the strip's OWN width (an `@container` wrapper), not the
 * viewport — like `CardGrid`. A metrics page sits beside the rail and the
 * settings panel, so at a 768px window its strip is ~400px wide: four cards
 * there were 100px each, their labels wrapping a word per line. A card keeps
 * ~145px+: four across from 36rem, three from 28rem, two below.
 */
const statCardGridVariants = cva(
  'border-border-base bg-border-base grid gap-px overflow-hidden rounded-lg border',
  {
    variants: {
      cols: {
        2: 'grid-cols-2',
        3: 'grid-cols-1 @md:grid-cols-3',
        4: 'grid-cols-2 @xl:grid-cols-4',
      },
    },
    defaultVariants: { cols: 4 },
  },
);

export interface StatCardGridProps extends VariantProps<
  typeof statCardGridVariants
> {
  children: ReactNode;
  className?: string;
}

export function StatCardGrid({ cols, children, className }: StatCardGridProps) {
  return (
    <div className="@container">
      <div className={cn(statCardGridVariants({ cols }), className)}>
        {children}
      </div>
    </div>
  );
}

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /**
   * Optional node rendered inline after the label (e.g. an info glyph wrapped in
   * a tooltip). Kept as a node so the caller owns tooltip + i18n.
   */
  tooltip?: ReactNode;
  /** Span both columns (e.g. a wider sentiment cell). */
  colSpan?: 1 | 2;
  /** Width of the skeleton placeholder while loading (default `w-16`). */
  loadingWidth?: string;
  /** Extra classes on the value (accent colors, larger size). */
  valueClassName?: string;
  /** Extra content rendered under the value (e.g. a sentiment bar). */
  children?: ReactNode;
  className?: string;
}

export function StatCard({
  label,
  value,
  tooltip,
  colSpan,
  loadingWidth = 'w-16',
  valueClassName,
  children,
  className,
}: StatCardProps) {
  const loading = useSkeleton();
  return (
    <div
      className={cn(
        'bg-bg-base flex flex-1 flex-col gap-1 p-5',
        colSpan === 2 && 'col-span-2',
        className,
      )}
    >
      {/* A flex row, so an info glyph beside the label centres on it instead
          of riding the text baseline and pushing this card's value lower than
          its neighbours'. */}
      <Text className="text-fg-muted flex min-h-5 items-center text-sm">
        {label}
        {tooltip}
      </Text>
      {/* Inter's tabular figures, not a monospace face: the headline numbers
          read in the UI's own type while digits still line up across cards. */}
      <Text
        className={cn(
          'text-fg-base text-2xl font-semibold tracking-tight tabular-nums',
          valueClassName,
        )}
      >
        <SkeletonBox asChild>
          <span
            className={cn('inline-block max-w-full', loading && loadingWidth)}
          >
            {value ?? '\u00a0'}
          </span>
        </SkeletonBox>
      </Text>
      {children}
    </div>
  );
}
