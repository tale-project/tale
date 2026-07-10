'use client';

/**
 * Connected `Collection` block — binds an allowlisted query and renders its rows
 * through the platform `DataTable` (column-size budget, typed skeletons, the
 * six-state body machine, managed search/filters via `useListPage`). Generic:
 * it shows whatever records the bound query returns (columns declared as specs
 * or bare field names, or inferred from the first row), so any list query can
 * drive it. The reactive binding lives here (Puck only composes the block); the
 * spec→ColumnDef mapping lives in `bound-columns`.
 *
 * Pagination is opt-in (set `perPage`): when on, the block reads through
 * `useBoundPaginatedQuery` (Convex cursor pagination, still a LIVE subscription)
 * and accumulates pages behind an explicit "Load more" button (`autoLoad`
 * off — a block is a card among others, it must not hijack page scroll); when
 * off, it's a single reactive read. The two paths live in separate inner
 * components so each calls exactly one data hook.
 *
 * `filters` is opt-in too, with two modes per entry:
 *  - `arg` (default): a single-select dropdown that merges the chosen value
 *    into the bound query's args (server-side narrowing) — the original
 *    contract, unchanged.
 *  - `client`: a faceted multi-select in the DataTable filter bar, narrowing
 *    the loaded rows client-side (`useListPage` managed filters).
 *
 * When `subjectType` is set, each row expands to show its workflow run inline
 * (`SubjectRun`), carries the run-status chip in its status cell, and offers
 * the re-run affordance — same contract as before the DataTable convergence.
 */
import { Button } from '@tale/ui/button';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Row } from '@tale/ui/layout';
import { ChevronDown, ListChecks } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import {
  DataTable,
  type DataTableAddAction,
} from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';
import {
  argsReferenceProjectId,
  argsReferenceViewState,
} from '@/lib/shared/platform/function_bindings';
import { resolveLocalizedProp } from '@/lib/shared/utils/resolve-automation-locale';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundAction } from '../../hooks/use-bound-action';
import { useBoundPaginatedQuery } from '../../hooks/use-bound-paginated-query';
import { useBoundQuery } from '../../hooks/use-bound-query';
import {
  useActionEffect,
  type ActionEffect,
} from '../../runtime/action-effects';
import { BindingStates, BlockFrame } from '../block-frame';
import { isEffectAction, type RowActionSpec } from './bound-button';
import {
  buildBoundColumns,
  useBoundRowIds,
  type BoundColumn,
  type BoundRow,
} from './bound-columns';
import { SubjectRerunAction } from './subject-rerun-action';
import { SubjectRun } from './subject-run';
import { SubjectRunStatusChip } from './subject-run-status-chip';

/** One filter: a query-arg (`mode: 'arg'`, single-select, the default) or a
 *  client-side facet (`mode: 'client'`, multi-select in the table filter bar). */
export interface CollectionFilterSpec {
  field: string;
  values: string[];
  /** Optional literal label for the control (else the capitalized field). */
  labelKey?: string;
  mode?: 'arg' | 'client';
  /** Literal display label per raw value; the raw value stays the
   *  dispatched arg — an unmapped value renders verbatim. */
  valueLabels?: Record<string, string>;
}

/** Empty-state copy (literals); defaults to the shared binding.empty. */
export interface CollectionEmptyStateSpec {
  titleKey?: string;
  descriptionKey?: string;
}

/** Managed client-side search over the loaded rows' declared fields. */
export interface CollectionSearchSpec {
  fields: string[];
  /** Literal placeholder text. */
  placeholderKey?: string;
}

export interface CollectionProps {
  title?: string;
  query: { path: string; args?: unknown };
  /** Columns to show — column specs; if omitted, inferred from the first row
   *  (minus id-like keys). */
  columns?: BoundColumn[];
  actions?: RowActionSpec[];
  /** When set, rows expand to show their workflow run inline (the execution
   *  "about" this subject). Generic — any domain list opts in. */
  subjectType?: string;
  /** Row field holding the subject id (default `_id`). */
  subjectIdField?: string;
  /** Page size; when set, the block paginates (cursor) and accumulates pages
   *  behind a "Load more" button. Omit for a single-shot reactive read. */
  perPage?: number;
  /** Filters — `arg` mode merges into the query args, `client` mode narrows
   *  the loaded rows in the table filter bar. */
  filters?: CollectionFilterSpec[];
  /** Empty-state copy override (title/description literals). */
  emptyState?: CollectionEmptyStateSpec;
  /** The single primary create affordance — a bound action OR effect-only
   *  (e.g. navigate), rendered in the table header. */
  addAction?: RowActionSpec;
  /** Managed client-side search over the given row fields. */
  search?: CollectionSearchSpec;
  /** Effect applied when a row is clicked (`$selected.*` binds the row). */
  onRowClick?: ActionEffect;
}

/** Inner-component props: the (filter-merged) query + the rendered filter bar. */
type InnerCollectionProps = CollectionProps & { filterBar?: ReactNode };

/** Radio-group value standing for "no filter" (Radix items can't be empty). */
const ALL_FILTER_VALUE = '__all__';

const DEFAULT_PAGE_SIZE = 50;

function pickArray(data: unknown): BoundRow[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data)) {
    for (const key of [
      'items',
      'tasks',
      'page',
      'rows',
      'records',
      'results',
    ]) {
      const v = data[key];
      if (Array.isArray(v)) return v.filter(isRecord);
    }
  }
  return [];
}

/** The arg-mode filter row — a single-select dropdown per declared filter. */
function CollectionFilterBar({
  filters,
  values,
  onChange,
}: {
  filters: CollectionFilterSpec[];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const { t } = useT('automations');
  return (
    <Row gap={2} wrap>
      {filters.map((f) => {
        const selected = values[f.field];
        const label = f.labelKey ?? f.field;
        // Enum-value display labels (`valueLabels`) — the raw value stays the
        // dispatched arg; unmapped values render verbatim.
        const valueLabelOf = (value: string) => f.valueLabels?.[value] ?? value;
        return (
          <DropdownMenu
            key={f.field}
            trigger={
              <Button variant="secondary" size="sm">
                <span
                  className={cn(
                    'text-muted-foreground',
                    // Match the column-header capitalize-the-raw-key fallback
                    // when the view didn't author a localized label.
                    !f.labelKey && 'capitalize',
                  )}
                >
                  {label}:
                </span>
                <span className="ml-1">
                  {selected !== undefined
                    ? valueLabelOf(selected)
                    : t('list.all')}
                </span>
                <ChevronDown className="ml-1 size-4" aria-hidden />
              </Button>
            }
            items={[
              [
                {
                  type: 'radio-group',
                  value: selected ?? ALL_FILTER_VALUE,
                  onValueChange: (v) => {
                    const next = { ...values };
                    if (v === ALL_FILTER_VALUE) delete next[f.field];
                    else next[f.field] = v;
                    onChange(next);
                  },
                  options: [
                    { value: ALL_FILTER_VALUE, label: t('list.all') },
                    ...f.values.map((v) => ({
                      value: v,
                      label: valueLabelOf(v),
                    })),
                  ],
                },
              ],
            ]}
          />
        );
      })}
    </Row>
  );
}

/**
 * Map the view's `addAction` (bound call OR effect-only) onto the DataTable's
 * standard add-button contract: label via the same rule as `BoundButton`,
 * dispatch + `onSuccess` (bound) or `applyEffect` (effect-only) on click.
 * Hook-shaped so it runs unconditionally (the bound hooks are instantiated
 * even when no addAction is declared — same posture as the `excludeBy` query
 * in `ExternalList`). Row-scoped fields (`when`/`doneWhen`/`confirm`) don't
 * apply to a collection-level create.
 */
function useBoundAddAction(
  spec: RowActionSpec | undefined,
): DataTableAddAction | undefined {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const boundPath = spec && !isEffectAction(spec) ? (spec.path ?? '') : '';
  const boundMode =
    spec && !isEffectAction(spec) ? (spec.mode ?? 'mutation') : 'mutation';
  const { dispatch, isPending } = useBoundAction(boundPath, boundMode);
  const applyEffect = useActionEffect();
  if (!spec) return undefined;
  const i18n =
    'i18n' in spec
      ? (spec.i18n as Record<string, Record<string, string>> | undefined)
      : undefined;
  const fallbackLabel = isEffectAction(spec)
    ? (spec.label ?? spec.labelKey ?? 'Add')
    : (spec.label ?? spec.path);
  const baseLabel = spec.labelKey
    ? t(spec.labelKey, { defaultValue: fallbackLabel })
    : fallbackLabel;
  const label =
    resolveLocalizedProp(baseLabel, i18n, 'label', locale) ?? baseLabel;
  const variant =
    spec.variant === 'ghost'
      ? 'ghost'
      : spec.variant === 'secondary'
        ? 'secondary'
        : 'primary';
  if (isEffectAction(spec)) {
    return {
      label,
      variant,
      onClick: () => {
        applyEffect(spec.effect);
      },
    };
  }
  return {
    label,
    variant,
    disabled: isPending,
    onClick: () => {
      dispatch(spec.args)
        .then((result) => applyEffect(spec.onSuccess, result))
        .catch((err: unknown) => {
          // The mutation/action layer already toasts + logs; surface here too
          // rather than swallowing the rejection.
          console.error(
            '[automation-binding] add action failed',
            spec.path,
            err,
          );
        });
    },
  };
}

/** `useListPage` data source — both Collection paths normalize to this. */
type CollectionDataSource =
  | {
      type: 'paginated';
      results: BoundRow[];
      status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted';
      loadMore: (numItems: number) => void;
      isLoading: boolean;
    }
  | { type: 'query'; data: BoundRow[] | undefined };

/**
 * The shared body: `useListPage` over the normalized data source → the rich
 * `DataTable`, framed by `BlockFrame` + `BindingStates` so the card chrome
 * (and optional title / arg-filter bar) wraps every body state.
 */
function CollectionBody({
  title,
  query,
  columns,
  actions,
  subjectType,
  subjectIdField = '_id',
  perPage,
  filters,
  emptyState,
  addAction,
  search,
  onRowClick,
  filterBar,
  dataSource,
  blocked,
  needsConfig,
}: InnerCollectionProps & {
  dataSource: CollectionDataSource;
  blocked: boolean;
  needsConfig: boolean;
}) {
  const { t } = useT('automations');
  const applyEffect = useActionEffect();
  const getRowId = useBoundRowIds();
  const tableAddAction = useBoundAddAction(addAction);

  const clientFilters = (filters ?? []).filter((f) => f.mode === 'client');

  const { tableProps, isLoading } = useListPage<BoundRow>({
    dataSource,
    pageSize: perPage ?? DEFAULT_PAGE_SIZE,
    search: search
      ? {
          fields: search.fields,
          placeholder: search.placeholderKey,
        }
      : undefined,
    filters:
      clientFilters.length > 0
        ? {
            definitions: clientFilters.map((f) => ({
              key: f.field,
              title: f.labelKey ?? f.field,
              options: f.values.map((v) => ({
                value: v,
                // Facet display labels — the raw value stays the facet key.
                label: f.valueLabels?.[v] ?? v,
              })),
            })),
          }
        : undefined,
    getRowId,
  });

  const rows = tableProps.data;
  const hasDeclaredColumns = Boolean(columns && columns.length > 0);
  const columnDefs = useMemo(
    () =>
      buildBoundColumns(columns, {
        rows,
        actions,
        rowActions: subjectType
          ? {
              idField: subjectIdField,
              render: (subjectId) => (
                <SubjectRerunAction
                  subjectType={subjectType}
                  subjectId={subjectId}
                />
              ),
            }
          : undefined,
        rowAccessory: subjectType
          ? {
              idField: subjectIdField,
              render: (subjectId, statusBadge) => (
                <SubjectRunStatusChip
                  subjectType={subjectType}
                  subjectId={subjectId}
                  fallback={statusBadge}
                />
              ),
            }
          : undefined,
      }),
    // When columns are declared, row data churn must not rebuild column defs —
    // that remounts BoundButton cells and drops in-flight latch state.
    hasDeclaredColumns
      ? [columns, actions, subjectType, subjectIdField]
      : [columns, actions, subjectType, subjectIdField, rows],
  );

  // A `$state.` / `$projectId` reference the args carry specializes the
  // generic `needsConfig` empty state — detected on the RAW args.
  const awaitingState = needsConfig && argsReferenceViewState(query.args);
  const needsProject =
    needsConfig && !awaitingState && argsReferenceProjectId(query.args);

  // The load-more affordance: always for the cursor-paginated path (the footer
  // also signals end-of-stream), and for the single-shot path only while the
  // loaded buffer actually exceeds the page size — a small one-shot list stays
  // footer-less, like before the DataTable convergence.
  const infinite =
    'infiniteScroll' in tableProps ? tableProps.infiniteScroll : undefined;
  const showInfinite =
    infinite !== undefined &&
    (dataSource.type === 'paginated' || infinite.hasMore);

  return (
    <BlockFrame
      title={title}
      icon={title ? ListChecks : undefined}
      actions={blocked || needsConfig ? undefined : filterBar}
    >
      <BindingStates
        blocked={blocked}
        path={query.path}
        needsConfig={needsConfig && !awaitingState && !needsProject}
        needsProject={needsProject}
        awaitingState={awaitingState}
      >
        <DataTable<BoundRow>
          columns={columnDefs}
          data={rows}
          getRowId={tableProps.getRowId}
          search={tableProps.search}
          filters={tableProps.filters}
          onClearFilters={tableProps.onClearFilters}
          isLoading={isLoading}
          {...(infinite && showInfinite
            ? {
                // Explicit "Load more" — a block is a card among page content,
                // so it never auto-loads on scroll (parity with the pre-
                // convergence button).
                infiniteScroll: { ...infinite, autoLoad: false },
              }
            : {})}
          emptyState={{
            title: emptyState?.titleKey ?? t('binding.empty'),
            description: emptyState?.descriptionKey,
          }}
          addAction={tableAddAction}
          enableExpanding={subjectType !== undefined}
          renderExpandedRow={
            subjectType
              ? (row) => {
                  const rawId = row.original[subjectIdField];
                  return typeof rawId === 'string' ? (
                    <SubjectRun subjectType={subjectType} subjectId={rawId} />
                  ) : null;
                }
              : undefined
          }
          onRowClick={
            onRowClick
              ? (row) => applyEffect(onRowClick, undefined, row.original)
              : undefined
          }
          clickableRows={onRowClick !== undefined}
        />
      </BindingStates>
    </BlockFrame>
  );
}

/** Single-shot reactive read — the original Collection behavior. */
function CollectionSingle(props: InnerCollectionProps) {
  const { data, isLoading, error, blocked, needsConfig } = useBoundQuery(
    props.query.path,
    props.query.args,
  );
  // Surface a Convex/query failure as a render error so the per-block
  // ErrorBoundary shows it (and logs `[automation-registry] block "Collection"
  // crashed`) instead of an empty table that looks like "no quarters".
  if (error) {
    throw error instanceof Error
      ? error
      : new Error(
          typeof error === 'string' ? error : 'Collection query failed',
        );
  }
  return (
    <CollectionBody
      {...props}
      dataSource={{
        type: 'query',
        // `undefined` while loading so the table shows its skeleton instead of
        // a premature empty state.
        data: isLoading ? undefined : pickArray(data),
      }}
      blocked={blocked}
      needsConfig={needsConfig}
    />
  );
}

/** Cursor-paginated read: accumulates pages behind "Load more" while staying
 *  a live subscription. */
function CollectionPaginated(props: InnerCollectionProps) {
  const { results, status, isLoading, loadMore, blocked, needsConfig } =
    useBoundPaginatedQuery(props.query.path, props.query.args, {
      perPage: props.perPage,
    });
  return (
    <CollectionBody
      {...props}
      dataSource={{ type: 'paginated', results, status, loadMore, isLoading }}
      blocked={blocked}
      needsConfig={needsConfig}
    />
  );
}

export function Collection(props: CollectionProps) {
  // Arg-filter state lives once here and is merged into the bound query's args,
  // so both inner paths get a filtered query + the same filter bar. `perPage`
  // and `filters` come from view config and never change at runtime, so picking
  // the path here is stable — each inner component owns a consistent hook set.
  const argFilters = (props.filters ?? []).filter((f) => f.mode !== 'client');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});

  const baseArgs = isRecord(props.query.args) ? props.query.args : {};
  const query =
    argFilters.length > 0
      ? { path: props.query.path, args: { ...baseArgs, ...filterValues } }
      : props.query;
  const filterBar =
    argFilters.length > 0 ? (
      <CollectionFilterBar
        filters={argFilters}
        values={filterValues}
        onChange={setFilterValues}
      />
    ) : null;

  return props.perPage !== undefined ? (
    <CollectionPaginated {...props} query={query} filterBar={filterBar} />
  ) : (
    <CollectionSingle {...props} query={query} filterBar={filterBar} />
  );
}
