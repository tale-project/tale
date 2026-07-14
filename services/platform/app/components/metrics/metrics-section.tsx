'use client';

import { Text } from '@tale/ui/text';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface MetricsSectionProps {
  /** Already-translated section heading. */
  title: string;
  /** Right-aligned header controls scoped to this section (filters, toggles).
   *  Stacks below the title on mobile. */
  actions?: ReactNode;
  /** Section body — typically a `DataTable` or a stat strip. */
  children: ReactNode;
  className?: string;
}

/**
 * The shared titled section for metrics bodies (top-N tables, arena summary…):
 * one h3 heading style + the standard `gap-3` rhythm, replacing the hand-rolled
 * header row every table used to carry. Charts keep their own chrome
 * (`ChartCard` owns its title); everything else on a metrics page sits in one
 * of these.
 */
export function MetricsSection({
  title,
  actions,
  children,
  className,
}: MetricsSectionProps) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      {actions ? (
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Text as="h3" className="text-foreground text-base font-semibold">
            {title}
          </Text>
          {actions}
        </div>
      ) : (
        <Text as="h3" className="text-foreground text-base font-semibold">
          {title}
        </Text>
      )}
      {children}
    </section>
  );
}
