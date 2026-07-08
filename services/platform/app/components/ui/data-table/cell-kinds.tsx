'use client';

/**
 * Shared per-kind cell renderers + the canonical status→badge map for tables
 * whose columns are declared as DATA (the automation-view `columnSpecSchema` kinds:
 * text | badge | datetime | number | id | two-line). Moved out of the deleted
 * `app/features/automations/registry/connected/data-table.tsx` so every DataTable
 * consumer shares ONE cell vocabulary instead of re-inventing badge maps and
 * scalar fallbacks per block. Pure presentational: values in, nodes out.
 */
import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';
import type { ReactNode } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';

type BadgeVariant = 'green' | 'destructive' | 'blue' | 'yellow' | 'slate';

/** Canonical status/state value → badge variant, shared across list blocks
 *  AND the operator collection panel — extend this union, never fork a copy. */
export const STATUS_VARIANT: Record<string, BadgeVariant> = {
  completed: 'green',
  done: 'green',
  open: 'green',
  failed: 'destructive',
  running: 'blue',
  in_progress: 'blue',
  paused: 'yellow',
  waiting: 'yellow',
  in_review: 'yellow',
  cancelled: 'slate',
  canceled: 'slate',
  closed: 'slate',
  pending: 'slate',
  todo: 'slate',
  backlog: 'slate',
  unknown: 'slate',
};

/** The closed cell-kind vocabulary (mirrors `columnSpecSchema.kind`). */
export type CellKind =
  | 'text'
  | 'badge'
  | 'datetime'
  | 'number'
  | 'id'
  | 'two-line';

/**
 * Scalar fallback for a data-declared cell: strings render as-is, numbers/
 * booleans stringify, nullish renders an em-dash, and anything structured is
 * truncated JSON (a visible "this isn't a scalar" signal, never a crash).
 */
export function formatScalarCell(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value).slice(0, 60);
}

/** The status/state badge (string values only; others fall back to text).
 *  `labels` maps a raw value to its RESOLVED display string (the caller owns
 *  `$label:` resolution); an unmapped value renders verbatim (fail-visible).
 *  The variant always keys off the raw value, so a localized label never
 *  changes the colour. */
export function StatusBadgeCell({
  value,
  labels,
}: {
  value: unknown;
  labels?: Record<string, string>;
}): ReactNode {
  if (typeof value !== 'string') return formatScalarCell(value);
  return (
    <Badge variant={STATUS_VARIANT[value] ?? 'slate'}>
      {labels?.[value] ?? value}
    </Badge>
  );
}

/**
 * The `meta.skeleton.type` a kind's loading placeholder should use — so a
 * declared column's skeleton matches its loaded shape (badge pill, two lines,
 * …). `undefined` means the DataTable's default text bar (align-aware).
 */
export function skeletonTypeForKind(
  kind: CellKind,
): 'badge' | 'two-line' | undefined {
  if (kind === 'badge') return 'badge';
  if (kind === 'two-line') return 'two-line';
  return undefined;
}

/**
 * Render one declared-kind cell. `secondary` feeds the `two-line` kind's muted
 * second line; `align` mirrors the column's alignment for self-aligning kinds
 * (number/datetime default right in the callers); `badgeLabels` maps raw
 * `badge`-kind values to resolved display strings (see `StatusBadgeCell`).
 */
export function renderCellKind(
  kind: CellKind,
  value: unknown,
  options?: {
    secondary?: unknown;
    align?: 'left' | 'center' | 'right';
    badgeLabels?: Record<string, string>;
  },
): ReactNode {
  switch (kind) {
    case 'badge':
      return <StatusBadgeCell value={value} labels={options?.badgeLabels} />;
    case 'datetime':
      // Dates right-align by platform convention (see `createDateColumn`);
      // `TableDateCell` owns nullish (—) and formatting.
      return (
        <TableDateCell
          date={
            typeof value === 'number' ||
            typeof value === 'string' ||
            value instanceof Date
              ? value
              : undefined
          }
          preset="short"
          alignRight={options?.align !== 'left' && options?.align !== 'center'}
        />
      );
    case 'number':
      return (
        <span
          className={
            options?.align === 'left'
              ? 'tabular-nums'
              : options?.align === 'center'
                ? 'block text-center tabular-nums'
                : 'block text-right tabular-nums'
          }
        >
          {formatScalarCell(value)}
        </span>
      );
    case 'id':
      return (
        <Text
          as="span"
          variant="code"
          className="text-muted-foreground block max-w-40 truncate text-xs"
          title={typeof value === 'string' ? value : undefined}
        >
          {formatScalarCell(value)}
        </Text>
      );
    case 'two-line':
      return (
        <div className="min-w-0">
          <Text as="span" className="block truncate text-sm">
            {formatScalarCell(value)}
          </Text>
          {options?.secondary !== undefined && (
            <Text as="span" variant="muted" className="block truncate text-xs">
              {formatScalarCell(options.secondary)}
            </Text>
          )}
        </div>
      );
    default:
      return formatScalarCell(value);
  }
}
