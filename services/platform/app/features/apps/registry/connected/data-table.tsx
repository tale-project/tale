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

import {
  BoundButton,
  EffectButton,
  isEffectAction,
  type RowActionSpec,
} from './bound-button';

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

/** Stable row key: the row's `_id`/`id` when present, else the array index.
 *  These lists are reactive and often newest-first, so a plain index key
 *  remounts every row when the head changes — keying by identity keeps row
 *  state (expansion, focus) attached to its record. */
function rowKey(row: Record<string, unknown>, index: number): string | number {
  const id = row._id ?? row.id;
  return typeof id === 'string' || typeof id === 'number' ? id : index;
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
  /** Per-row actions, bound to the row: function-calling `BoundButton`s or
   *  effect-only `EffectButton`s (e.g. open the row's detail overlay). */
  actions?: RowActionSpec[];
  /** When set, each row expands to render detail in-context (the `idField` value
   *  is passed to `render`). */
  expansion?: {
    idField: string;
    render: (subjectId: string) => React.ReactNode;
  };
  /** Optional per-row accessory that owns the status/state cell: it receives the
   *  row's `idField` value and the default status badge, and returns either that
   *  badge or an ambient replacement (e.g. a "queued for capacity" chip shown
   *  *instead of* the badge, so a row never reads as both states at once). Like
   *  `expansion`, this keeps the table domain-agnostic — the caller injects the
   *  connected component, which alone knows when to swap. A row with no
   *  status/state column, or a non-string idField value, renders the badge. */
  rowAccessory?: {
    idField: string;
    render: (
      subjectId: string,
      statusBadge: React.ReactNode,
    ) => React.ReactNode;
  };
  /** Optional per-row action injected into the actions cell alongside the
   *  view-config `actions` — for an affordance gated on state the row itself
   *  doesn't carry (e.g. a "Re-run" shown only when the row's latest run failed,
   *  which the connected component knows and the row's `when` can't). Receives
   *  the row's `idField` value; renders nothing when it has nothing to add, and
   *  its presence alone makes the actions column appear. */
  rowActions?: {
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
  rowAccessory,
  rowActions,
  maxRows = 50,
}: DataTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const cols = inferColumns(rows, columns);
  const acts = actions ?? [];
  const hasActionsCol = acts.length > 0 || rowActions !== undefined;
  const colCount = cols.length + (expansion ? 1 : 0) + (hasActionsCol ? 1 : 0);

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
          {hasActionsCol && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.slice(0, maxRows).map((row, i) => {
          const rawId = expansion ? row[expansion.idField] : undefined;
          const subjectId = typeof rawId === 'string' ? rawId : undefined;
          const expandable = subjectId !== undefined;
          const rawRowActionId = rowActions
            ? row[rowActions.idField]
            : undefined;
          const rowActionId =
            typeof rawRowActionId === 'string' ? rawRowActionId : undefined;
          const isExpanded = expandable && expandedId === subjectId;
          return (
            <Fragment key={rowKey(row, i)}>
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
                {cols.map((c) => {
                  const isStatusCol = c === 'status' || c === 'state';
                  const rawAccessoryId = rowAccessory
                    ? row[rowAccessory.idField]
                    : undefined;
                  const accessoryId =
                    typeof rawAccessoryId === 'string'
                      ? rawAccessoryId
                      : undefined;
                  const statusBadge = cell(c, row[c]);
                  // The accessory owns the status cell so it can show the
                  // ambient chip *in place of* the badge — the parked state
                  // lives in the connected component, so it decides; otherwise
                  // it returns the badge unchanged.
                  const content =
                    isStatusCol && rowAccessory && accessoryId !== undefined
                      ? rowAccessory.render(accessoryId, statusBadge)
                      : statusBadge;
                  return <TableCell key={c}>{content}</TableCell>;
                })}
                {hasActionsCol && (
                  // Stop row-click expansion when interacting with actions.
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Row gap={2} align="stretch" wrap>
                      {acts.map((a, ai) =>
                        isEffectAction(a) ? (
                          <EffectButton key={ai} action={a} item={row} />
                        ) : (
                          <BoundButton key={ai} action={a} item={row} />
                        ),
                      )}
                      {rowActions &&
                        rowActionId !== undefined &&
                        rowActions.render(rowActionId)}
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
