'use client';

import { cn } from '@tale/ui/cn';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ReactNode } from 'react';

import type { DataTableSkeleton } from './data-table-skeleton-cell';

interface TableIconCellProps {
  /**
   * The row's mark, passed bare — the 20px slot around it is what keeps every
   * table's label at the same offset.
   *
   * Under the default `tile` variant this is a monochrome glyph (a Lucide
   * icon, an Iconify `<Icon>`, a `ConfigIcon`) that the tile sizes and colours
   * itself. Under `plain` it draws itself; size it to the slot.
   */
  icon: ReactNode;
  /**
   * How the mark is framed. `tile` (default) gives a monochrome glyph a muted
   * square to sit in; `plain` leaves the slot empty for a mark that carries
   * its own shape and colour — a file-type icon, a vendor logo, an avatar.
   */
  variant?: 'tile' | 'plain';
  /**
   * The row's name. A string gets the shared label style and truncation; a
   * node is rendered untouched, for a label that has to be a link or a button
   * (and then owns its own truncation and `title`).
   */
  label: ReactNode;
  /**
   * Chips riding beside the label — a kind, a catalog tag, a record state.
   * They keep their own width; the label is what gives way when the column
   * narrows.
   */
  badges?: ReactNode;
  /**
   * A second line under the label, for an address the reader needs beside the
   * name (an automation's slug). Pair it with `tableIconCellSkeleton({ lines: 2 })`
   * so the loading mask is the same height as the loaded row.
   */
  caption?: ReactNode;
  /** Native `title` on a string label, so a truncated value reads on hover. */
  title?: string;
  className?: string;
}

/**
 * A list's icon-and-name cell: a 20px mark, 8px, then the name.
 *
 * One composition for every collection screen, so a reader's eye lands in the
 * same place on each and a row keeps its height whichever mark it carries.
 * The gap and the slot are the contract — a list that sets its own leaves its
 * labels a few pixels off every other list's.
 *
 * The mark is decorative; the label carries the meaning, so nothing here needs
 * an accessible name of its own.
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
  variant = 'tile',
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
        className={cn(
          'size-5 shrink-0',
          variant === 'tile' &&
            'bg-muted text-muted-foreground rounded [&_svg]:size-3',
        )}
      >
        {icon}
      </Row>
      {/* `min-w-0` lets the text column shrink below its content width so the
          label's `truncate` engages instead of pushing into the next cell. */}
      <Stack gap={0} className="min-w-0">
        <Row gap={2} className="min-w-0">
          {typeof label === 'string' || typeof label === 'number' ? (
            <Text as="span" variant="label" truncate title={title}>
              {label}
            </Text>
          ) : (
            label
          )}
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
 * The loading mask a `TableIconCell` column pairs with: the cell's own 20px
 * slot rather than the skeleton's bare-icon default, so the placeholder row
 * and the loaded row are the same height and nothing jumps on arrival.
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
