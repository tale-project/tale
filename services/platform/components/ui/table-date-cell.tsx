'use client';

import * as React from 'react';
import { formatDate, type DatePreset } from '@/lib/utils/date/format';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

export interface TableDateCellProps {
  /** The date to display (timestamp, Date, or ISO string) */
  date: number | Date | string | null | undefined;
  /** Format preset: 'short', 'long', 'relative', 'time', 'medium' */
  preset?: DatePreset;
  /** Additional className */
  className?: string;
  /** Text to show when date is null/undefined */
  emptyText?: string;
  /** Whether to align text to the right */
  alignRight?: boolean;
}

/**
 * Standardized table date cell component.
 * Provides consistent date formatting across all tables.
 *
 * @example
 * ```tsx
 * // In column definition
 * {
 *   id: 'createdAt',
 *   header: 'Created',
 *   cell: ({ row }) => (
 *     <TableDateCell date={row.original._creationTime} preset="relative" />
 *   ),
 * }
 * ```
 */
export const TableDateCell = React.memo(function TableDateCell({
  date,
  preset = 'short',
  className,
  emptyText = '—',
  alignRight = false,
}: TableDateCellProps) {
  const locale = useLocale();

  if (date === null || date === undefined) {
    return (
      <span
        className={cn(
          'text-sm text-muted-foreground',
          alignRight && 'text-right block',
          className
        )}
      >
        {emptyText}
      </span>
    );
  }

  const dateObj = typeof date === 'number' || typeof date === 'string'
    ? new Date(date)
    : date;

  const formatted = formatDate(dateObj, { preset, locale });

  return (
    <span
      className={cn(
        'text-sm text-muted-foreground',
        alignRight && 'text-right block',
        className
      )}
      title={dateObj.toLocaleString()}
    >
      {formatted}
    </span>
  );
});

export interface TableTimestampCellProps {
  /** The timestamp in milliseconds */
  timestamp: number | null | undefined;
  /** Format preset */
  preset?: DatePreset;
  /** Additional className */
  className?: string;
  /** Whether to align text to the right */
  alignRight?: boolean;
}

/**
 * Convenience component for displaying Convex _creationTime timestamps.
 *
 * @example
 * ```tsx
 * <TableTimestampCell timestamp={row.original._creationTime} />
 * ```
 */
export const TableTimestampCell = React.memo(function TableTimestampCell({
  timestamp,
  preset = 'relative',
  className,
  alignRight = true,
}: TableTimestampCellProps) {
  return (
    <TableDateCell
      date={timestamp}
      preset={preset}
      className={className}
      alignRight={alignRight}
    />
  );
});
