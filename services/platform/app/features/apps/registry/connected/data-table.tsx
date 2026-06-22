'use client';

/**
 * The shared presentational table for connected list blocks — generic columns
 * (explicit or inferred from the first row), a status/state → badge cell
 * renderer, optional per-row `BoundButton` actions, and optional row expansion
 * (passed as a render-prop, so this file imports no domain/run code). Both
 * `Collection` (reactive query) and `ExternalList` (action-sourced) render their
 * rows through this; each block keeps its own data binding + empty/loading/error
 * framing. Pure: it takes already-parsed `rows`.
 */
import { Badge } from '@tale/ui/badge';
import { Row } from '@tale/ui/layout';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tale/ui/table';
import { ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';

import { cn } from '@/lib/utils/cn';

import { BoundButton, type BoundActionSpec } from './bound-button';

/** Columns never worth showing as data (ids / framework fields). */
const HIDDEN = new Set([
  '_id',
  '_creationTime',
  'id',
  'taskId',
  'executionId',
  'organizationId',
  'projectId',
]);

type BadgeVariant = 'green' | 'destructive' | 'blue' | 'yellow' | 'slate';

/** Canonical status/state value → badge variant, shared across list blocks. */
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
};

/** Render one cell value — status/state columns as a badge; scalars as text. */
function cell(col: string, value: unknown): React.ReactNode {
  if ((col === 'status' || col === 'state') && typeof value === 'string') {
    return <Badge variant={STATUS_VARIANT[value] ?? 'slate'}>{value}</Badge>;
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value).slice(0, 60);
}

/** Columns to show: explicit, else inferred from the first row (minus id-like keys). */
function inferColumns(
  rows: Record<string, unknown>[],
  columns?: string[],
): string[] {
  if (columns && columns.length > 0) return columns;
  const first = rows[0];
  return first
    ? Object.keys(first)
        .filter((k) => !HIDDEN.has(k))
        .slice(0, 6)
    : [];
}

export interface DataTableProps {
  rows: Record<string, unknown>[];
  /** Columns to show; if omitted, inferred from the first row. */
  columns?: string[];
  /** Header text per column key (already locale-resolved by the caller); a column
   *  with no entry falls back to its capitalized key. */
  columnLabels?: Record<string, string>;
  /** Per-row actions, rendered as `BoundButton`s bound to the row. */
  actions?: BoundActionSpec[];
  /** When set, each row expands to render detail in-context (the `idField` value
   *  is passed to `render`). */
  expansion?: {
    idField: string;
    render: (subjectId: string) => React.ReactNode;
  };
  /** Cap on rendered rows (default 50). */
  maxRows?: number;
}

export function DataTable({
  rows,
  columns,
  columnLabels,
  actions,
  expansion,
  maxRows = 50,
}: DataTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const cols = inferColumns(rows, columns);
  const acts = actions ?? [];
  const colCount =
    cols.length + (expansion ? 1 : 0) + (acts.length > 0 ? 1 : 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {expansion && <TableHead className="w-8" />}
          {cols.map((c) => (
            <TableHead key={c} className="capitalize">
              {columnLabels?.[c] ?? c}
            </TableHead>
          ))}
          {acts.length > 0 && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.slice(0, maxRows).map((row, i) => {
          const rawId = expansion ? row[expansion.idField] : undefined;
          const subjectId = typeof rawId === 'string' ? rawId : undefined;
          const expandable = subjectId !== undefined;
          const isExpanded = expandable && expandedId === subjectId;
          return (
            <Fragment key={i}>
              <TableRow
                className={cn(expandable && 'cursor-pointer')}
                onClick={
                  expandable
                    ? () =>
                        setExpandedId(isExpanded ? null : (subjectId ?? null))
                    : undefined
                }
              >
                {expansion && (
                  <TableCell className="w-8">
                    {expandable && (
                      <ChevronRight
                        className={cn(
                          'text-muted-foreground size-4 transition-transform',
                          isExpanded && 'rotate-90',
                        )}
                        aria-hidden
                      />
                    )}
                  </TableCell>
                )}
                {cols.map((c) => (
                  <TableCell key={c}>{cell(c, row[c])}</TableCell>
                ))}
                {acts.length > 0 && (
                  // Stop row-click expansion when interacting with actions.
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Row gap={2} align="stretch" wrap>
                      {acts.map((a, ai) => (
                        <BoundButton key={ai} action={a} item={row} />
                      ))}
                    </Row>
                  </TableCell>
                )}
              </TableRow>
              {isExpanded && subjectId && expansion && (
                <TableRow>
                  <TableCell colSpan={colCount} className="bg-muted/30">
                    {expansion.render(subjectId)}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
