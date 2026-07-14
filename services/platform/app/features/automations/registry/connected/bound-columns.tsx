'use client';

/**
 * The view-JSON → DataTable bridge for connected list blocks: maps a block's
 * `columns` (bare field names or `columnSpecSchema` specs) onto TanStack
 * `ColumnDef`s for the platform `DataTable` — per-kind cell renderers
 * (`cell-kinds`), typed skeleton meta, the declared `size` feeding the
 * column-size budget, `flex`/`align` meta, literal headers with the
 * capitalized-key fallback, and the trailing actions column rendering
 * the `BoundButton` cluster. Also home to the small shared plumbing both list
 * blocks need around the mapping: stable row ids for rows that may carry no
 * `_id` (external rows), and the `$state.` scan that decides whether an
 * unresolved binding reads as "needs configuration" or "awaiting selection".
 */
import { Row } from '@tale/ui/layout';
import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useRef, type ReactNode } from 'react';
import type { z } from 'zod';

import {
  renderCellKind,
  skeletonTypeForKind,
  StatusBadgeCell,
  type CellKind,
} from '@/app/components/ui/data-table/cell-kinds';
import type { columnSpecSchema } from '@/lib/shared/schemas/automation_views';
import {
  resolveLocalizedProp,
  resolveValueLabels,
} from '@/lib/shared/utils/resolve-automation-locale';

import {
  BoundButton,
  EffectButton,
  isEffectAction,
  type RowActionSpec,
} from './bound-button';

/** One declared column — `z.infer` of the view schema (no runtime twin). */
export type ColumnSpec = z.infer<typeof columnSpecSchema>;

/** A block's `columns` entry. */
export type BoundColumn = ColumnSpec;

/** The row shape every bound list works over (already record-filtered). */
export type BoundRow = Record<string, unknown>;

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

/**
 * Width for the bound actions column. Wider than `ACTIONS_COLUMN_SIZE` (the
 * icon-only 3-dot trigger) because bound blocks render an in-line labelled
 * `BoundButton` cluster (e.g. "Start" + "Open Knowledge"). Sized for two `sm`
 * labelled buttons on one row — wrapping inside the pinned box overflows the
 * row border and clips into the header divider.
 */
export const BOUND_ACTIONS_COLUMN_SIZE = 260;

/**
 * Stable `getRowId` for bound rows: `_id`/`id` when present (Convex rows,
 * external rows with native ids), else a per-object id minted once and kept in
 * a WeakMap — so accumulated pages keep their identity across re-renders
 * without leaking a synthetic field into column inference.
 */
export function useBoundRowIds(): (row: BoundRow) => string {
  const idsRef = useRef(new WeakMap<BoundRow, string>());
  const counterRef = useRef(0);
  return useCallback((row: BoundRow) => {
    const explicit = row._id ?? row.id;
    if (typeof explicit === 'string') return explicit;
    if (typeof explicit === 'number') return String(explicit);
    let minted = idsRef.current.get(row);
    if (minted === undefined) {
      minted = `bound-row-${counterRef.current++}`;
      idsRef.current.set(row, minted);
    }
    return minted;
  }, []);
}

export interface BoundColumnsContext {
  /** Loaded rows — used only to infer columns when none are declared. */
  rows: BoundRow[];
  /** Active UI locale — resolves each column's `i18n.<locale>.label` /
   *  `.valueLabels` overrides over the English literals. */
  locale: string;
  /** View-config per-row actions, rendered as a BoundButton / EffectButton cluster. */
  actions?: RowActionSpec[];
  /** Injected per-row action (e.g. subject re-run) merged into the actions
   *  cell; its presence alone makes the actions column appear. */
  rowActions?: {
    idField: string;
    render: (subjectId: string) => ReactNode;
  };
  /** Owns the status/state badge cell (e.g. the run-status chip shown INSTEAD
   *  of the badge) — same contract as the old registry table. */
  rowAccessory?: {
    idField: string;
    render: (subjectId: string, statusBadge: ReactNode) => ReactNode;
  };
  /** Gates the whole actions cluster per subject row — lets the connected
   *  layer suppress it while the row's run awaits operator input (a config
   *  "Start" there would re-run without the answer). */
  actionsGate?: {
    idField: string;
    render: (subjectId: string, cluster: ReactNode) => ReactNode;
  };
}

/** Infer columns from the first row when undeclared. */
function normalizeColumns(
  columns: BoundColumn[] | undefined,
  rows: BoundRow[],
): ColumnSpec[] {
  if (columns && columns.length > 0) return [...columns];
  const first = rows[0];
  return first
    ? Object.keys(first)
        .filter((k) => !HIDDEN.has(k))
        .slice(0, 6)
        .map((field) => ({ field }))
    : [];
}

/** The kind a bare field name implies (status/state columns badge, as before). */
function inferKind(spec: ColumnSpec): CellKind {
  if (spec.kind) return spec.kind;
  return spec.field === 'status' || spec.field === 'state' ? 'badge' : 'text';
}

/**
 * Build the `ColumnDef[]` for a bound list block. Header precedence:
 * the column's `i18n.<locale>.label` override → `labelKey` (the English
 * literal) → the raw field key CSS-capitalized (the old table's fallback).
 * The actions column is appended when view actions or an injected row
 * action exist.
 */
export function buildBoundColumns(
  columns: BoundColumn[] | undefined,
  ctx: BoundColumnsContext,
): ColumnDef<BoundRow>[] {
  const locale = ctx.locale;
  const specs = normalizeColumns(columns, ctx.rows);
  const defs: ColumnDef<BoundRow>[] = specs.map((spec) => {
    const field = spec.field;
    const kind = inferKind(spec);
    const align =
      spec.align ??
      (kind === 'number' || kind === 'datetime' ? 'right' : undefined);
    const label =
      resolveLocalizedProp(spec.labelKey, spec.i18n, 'label', locale) ??
      spec.labelKey;
    // The two-line kind's muted second line (`columnSpecSchema.secondaryField`).
    const secondaryField =
      typeof spec.secondaryField === 'string' ? spec.secondaryField : undefined;
    // Badge-kind display labels (`columnSpecSchema.valueLabels`), per raw
    // value with `i18n.<locale>.valueLabels` overrides — an unmapped value
    // renders verbatim.
    const valueLabels = resolveValueLabels(spec.valueLabels, spec.i18n, locale);
    const headerClass =
      align === 'right'
        ? 'block w-full text-right'
        : align === 'center'
          ? 'block w-full text-center'
          : undefined;
    const skeletonType = skeletonTypeForKind(kind);

    // Built by conditional assignment (not conditional spreads): an absent key
    // must stay ABSENT — an explicit `undefined` would override the DataTable /
    // TanStack defaults merged over the def — and object spreads inside `map`
    // are a lint error (oxc/no-map-spread).
    const meta: {
      skeleton?: { type: NonNullable<typeof skeletonType> };
      align?: 'left' | 'center' | 'right';
      flex?: boolean;
    } = {};
    if (skeletonType) meta.skeleton = { type: skeletonType };
    if (align) meta.align = align;
    if (spec.flex) meta.flex = true;

    const def: ColumnDef<BoundRow> = {
      id: field,
      // accessorFn (not accessorKey): a field name containing `.` must stay a
      // literal key, never a deep path.
      accessorFn: (row) => row[field],
      header: () => (
        <span
          className={
            label === undefined
              ? // The old table's fallback: the raw key, CSS-capitalized.
                [headerClass, 'capitalize'].filter(Boolean).join(' ')
              : headerClass
          }
        >
          {label ?? field}
        </span>
      ),
      meta,
      cell: ({ row }) => {
        const value = row.original[field];
        const isStatusField = field === 'status' || field === 'state';
        // The accessory owns the status cell so it can show an ambient chip
        // *in place of* the badge — the parked state lives in the connected
        // component, so it decides; otherwise it returns the badge unchanged.
        if (kind === 'badge' && isStatusField && ctx.rowAccessory) {
          const rawId = row.original[ctx.rowAccessory.idField];
          if (typeof rawId === 'string') {
            return ctx.rowAccessory.render(
              rawId,
              <StatusBadgeCell value={value} labels={valueLabels} />,
            );
          }
        }
        return renderCellKind(kind, value, {
          align,
          secondary: secondaryField ? row.original[secondaryField] : undefined,
          badgeLabels: valueLabels,
        });
      },
    };
    if (spec.size !== undefined) def.size = spec.size;
    return def;
  });

  const actions = ctx.actions ?? [];
  if (actions.length > 0 || ctx.rowActions) {
    defs.push({
      id: 'actions',
      size: BOUND_ACTIONS_COLUMN_SIZE,
      meta: { isAction: true },
      cell: ({ row }) => {
        const item = row.original;
        const rawRowActionId = ctx.rowActions
          ? item[ctx.rowActions.idField]
          : undefined;
        const rowActionId =
          typeof rawRowActionId === 'string' ? rawRowActionId : undefined;
        const cluster = (
          <>
            {actions.map((a, ai) =>
              isEffectAction(a) ? (
                <EffectButton key={ai} action={a} item={item} />
              ) : (
                <BoundButton key={ai} action={a} item={item} />
              ),
            )}
            {ctx.rowActions &&
              rowActionId !== undefined &&
              ctx.rowActions.render(rowActionId)}
          </>
        );
        const rawGateId = ctx.actionsGate
          ? item[ctx.actionsGate.idField]
          : undefined;
        return (
          // Stop row-click expansion / onRowClick when interacting with actions.
          <Row
            gap={2}
            align="center"
            justify="end"
            onClick={(e) => e.stopPropagation()}
          >
            {ctx.actionsGate && typeof rawGateId === 'string'
              ? ctx.actionsGate.render(rawGateId, cluster)
              : cluster}
          </Row>
        );
      },
    });
  }

  return defs;
}
