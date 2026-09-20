'use client';

import { cn } from '@tale/ui/cn';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ReactNode } from 'react';

import type { DataTableSkeleton } from './data-table-skeleton-cell';

interface TableIconCellProps {
  /**
   * The row's glyph. Any element that renders an `<svg>` — a Lucide icon, an
   * Iconify `<Icon>`, a `ConfigIcon` — passed bare: the tile owns its size and
   * colour so no two tables can drift apart on either.
   */
  icon: ReactNode;
  /** The row's primary label. Truncates at the cell edge. */
  label: ReactNode;
  /**
   * Chips riding beside the label — a kind, a catalog tag. They keep their own
   * width; the label is what gives way when the column narrows.
   */
  badges?: ReactNode;
  /**
   * A second line under the label, for an address the reader needs beside the
   * name (an automation's slug). Pair it with `tableIconCellSkeleton({ lines: 2 })`
   * so the loading mask is the same height as the loaded row.
   */
  caption?: ReactNode;
  /** Native `title` on the label, so a truncated value is readable on hover. */
  title?: string;
  className?: string;
}

/**
 * The first column of an entity list: a glyph in a muted tile, then the name.
 *
 * One composition for every collection screen — Knowledge entries, Websites,
 * Automations — so a reader's eye lands in the same place on each, and a row
 * keeps its height whichever glyph it carries. The tile is decorative; the
 * label carries the meaning, so nothing here needs an accessible name of its
 * own.
 *
 * @example
 * ```tsx
 * {
 *   accessorKey: 'domain',
 *   header: tTables('headers.website'),
 *   size: 256,
 *   meta: { flex: true, skeleton: tableIconCellSkeleton() },
 *   cell: ({ row }) => (
 *     <TableIconCell icon={<Globe />} label={row.original.domain} />
 *   ),
 * }
 * ```
 */
export function TableIconCell({
  icon,
  label,
  badges,
  caption,
  title,
  className,
}: TableIconCellProps) {
  return (
    <Row gap={2} className={cn('min-w-0', className)}>
      <Row
        gap={0}
        justify="center"
        aria-hidden
        className="bg-muted text-muted-foreground size-5 shrink-0 rounded [&_svg]:size-3"
      >
        {icon}
      </Row>
      {/* `min-w-0` lets the text column shrink below its content width so the
          label's `truncate` engages instead of pushing into the next cell. */}
      <Stack gap={0} className="min-w-0">
        <Row gap={2} className="min-w-0">
          <Text as="span" variant="label" truncate title={title}>
            {label}
          </Text>
          {badges}
        </Row>
        {caption === undefined ? null : (
          <Text as="span" variant="caption" truncate>
            {caption}
          </Text>
        )}
      </Stack>
    </Row>
  );
}

/**
 * The loading mask a `TableIconCell` column pairs with: the tile's own 20px
 * footprint rather than the skeleton's bare-icon default, so the placeholder
 * row and the loaded row are the same height and nothing jumps on arrival.
 *
 * Pass `{ lines: 2 }` when the cell renders a `caption`.
 */
export function tableIconCellSkeleton(options?: {
  lines?: 1 | 2;
}): DataTableSkeleton {
  return {
    type: 'icon-text',
    icon: <span className="size-5" />,
    lines: options?.lines ?? 1,
  };
}
