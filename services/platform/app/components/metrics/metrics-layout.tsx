'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface MetricsLayoutProps {
  /** Page/section title. */
  title: string;
  /** One-line description under the title. */
  description?: string;
  /** Heading element — `h2` for standalone routes, `h3` when embedded in a
   *  settings tab that already owns the page heading. */
  as?: 'h2' | 'h3';
  /** Right-aligned header controls (period/granularity/metric selects). Stacks
   *  below the title on mobile. */
  toolbar?: ReactNode;
  /** Active-filter chips row, shown directly under the header. */
  filters?: ReactNode;
  /** Notices (capped sample / empty / filtered) — pass `<Alert>`s. */
  notice?: ReactNode;
  /** Body: KPI row, charts, tables — in the canonical order. */
  children: ReactNode;
  className?: string;
}

/**
 * The shared shell for every metrics surface (automations, usage, feedback,
 * project, agent scorecard, workforce). Gives them ONE structure — a responsive
 * header (title + description + toolbar), a filter-chips row, a notices slot,
 * then the body at the standard `gap-6` rhythm — so the pages stop looking
 * hand-rolled and different. Padding-agnostic: the host (a route's
 * `ContentArea` or a settings tab) owns the outer container.
 */
export function MetricsLayout({
  title,
  description,
  as: Tag = 'h2',
  toolbar,
  filters,
  notice,
  children,
  className,
}: MetricsLayoutProps) {
  return (
    <Stack gap={6} className={className}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <Tag className="text-foreground text-base font-semibold">{title}</Tag>
          {description ? <Text variant="caption">{description}</Text> : null}
        </div>
        {toolbar ? (
          <HStack gap={2} className="flex-wrap">
            {toolbar}
          </HStack>
        ) : null}
      </div>

      {filters}
      {notice ? (
        <div className={cn('flex flex-col gap-3')}>{notice}</div>
      ) : null}

      {children}
    </Stack>
  );
}
