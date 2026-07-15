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
import { Row, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ChevronDown, ListChecks, Plus } from 'lucide-react';
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
import { evaluateWhen } from '@/lib/shared/platform/when_predicate';
import {
  resolveLocalizedProp,
  resolveValueLabels,
  type PackI18nMap,
} from '@/lib/shared/utils/resolve-automation-locale';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-utils';

import { useBlockWhenGate } from '../../hooks/use-block-when-gate';
import { useBoundAction } from '../../hooks/use-bound-action';
import { useBoundPaginatedQuery } from '../../hooks/use-bound-paginated-query';
import { useBoundQuery } from '../../hooks/use-bound-query';
import {
  useActionEffect,
  type ActionEffect,
} from '../../runtime/action-effects';
import { BindingStates, BlockFrame } from '../block-frame';
import { AddActionFormDialog } from './add-action-form-dialog';
import { isEffectAction, type RowActionSpec } from './bound-button';
import {
  buildBoundColumns,
  useBoundRowIds,
  type BoundColumn,
  type BoundRow,
} from './bound-columns';
import { FolderUploadCard } from './folder-upload-card';
import { SubjectAwaitingInputActions } from './subject-awaiting-input-actions';
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
  /** Per-locale overrides for `labelKey`/`valueLabels`. */
  i18n?: PackI18nMap;
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
  /** Per-locale overrides for the block `title` (`i18n.de.title`, …). */
  i18n?: PackI18nMap;
  /** Hide the whole block (list + create action) when this predicate is
   *  false — same `when`/`whenQuery` gate the Form/Text/Alert blocks use. */
  when?: string;
  whenQuery?: { path: string; args?: unknown };
  query: { path: string; args?: unknown };
  /** Client-side row filter (when_predicate grammar), e.g. `!hasTask` —
   *  rows failing the predicate never render. Same contract as
   *  ExternalList's `rowWhen`. */
  rowWhen?: string;
  /** Columns to show — column specs; if omitted, inferred from the first row
   *  (minus id-like keys). */
  columns?: BoundColumn[];
  actions?: RowActionSpec[];
  /** When set, rows expand to show their workflow run inline (the execution
   *  "about" this subject). Generic — any domain list opts in. */
  subjectType?: string;
  /** Row field holding the subject id (default `_id`). */
  subjectIdField?: string;
  /**
   * Renders the expanded panel's INPUT section: an upload card over the
   * project folder whose id the named row field carries (e.g. a desk task's
   * `externalId`). Open while the folder is empty, collapsed once it has
   * files.
   */
  subjectUpload?: { folderIdField: string };
  /** Pack-declared deliverable names for the pre-run Outcome placeholder. */
  subjectOutcome?: { promises: string[] };
  /**
   * Auto-expand rows matching this when_predicate ONCE when they first load
   * (e.g. `status == backlog` — a fresh row whose expanded Input card is the
   * next step). A manual collapse is never fought.
   */
  defaultExpandWhen?: string;
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
  /** Where the `addAction` sits: `toolbar` (default — inside the card's
   *  filter row) or `above` (a right-aligned button in its own row OUTSIDE
   *  the card, for a view-level primary create like "New quarter").
   *  Ignored when `chrome` is `list` (toolbar is the list pattern). */
  addActionPlacement?: 'toolbar' | 'above';
  /**
   * Frame chrome: `card` (default — titled Section/Card with filters in the
   * header) or `list` (entity-list pattern — title above, arg filters + Plus
   * add on the DataTable toolbar, bordered grid only).
   */
  chrome?: 'card' | 'list';
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
  const { locale } = useLocale();
  return (
    <Row gap={2} wrap>
      {filters.map((f) => {
        const selected = values[f.field];
        const authoredLabel =
          resolveLocalizedProp(f.labelKey, f.i18n, 'label', locale) ??
          f.labelKey;
        const label = authoredLabel ?? f.field;
        // Enum-value display labels (`valueLabels`, with `i18n.<locale>`
        // overrides) — the raw value stays the dispatched arg; unmapped
        // values render verbatim.
        const localizedValueLabels = resolveValueLabels(
          f.valueLabels,
          f.i18n,
          locale,
        );
        const valueLabelOf = (value: string) =>
          localizedValueLabels?.[value] ?? value;
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
                    authoredLabel === undefined && 'capitalize',
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
  /** Present when the spec carries `form.fields` — the click opens the
   *  dialog instead of dispatching directly. */
  onFormOpen?: () => void,
): DataTableAddAction | undefined {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const boundPath = spec && !isEffectAction(spec) ? (spec.path ?? '') : '';
  const boundMode =
    spec && !isEffectAction(spec) ? (spec.mode ?? 'mutation') : 'mutation';
  const { dispatch, isPending } = useBoundAction(boundPath, boundMode);
  const applyEffect = useActionEffect();
  if (!spec) return undefined;
  let i18n: Record<string, Record<string, unknown>> | undefined;
  if ('i18n' in spec && isRecord(spec.i18n)) {
    const map: Record<string, Record<string, unknown>> = {};
    for (const [localeKey, props] of Object.entries(spec.i18n)) {
      if (isRecord(props)) map[localeKey] = props;
    }
    i18n = map;
  }
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
  if (!isEffectAction(spec) && spec.form && onFormOpen) {
    return { label, variant, onClick: onFormOpen };
  }
  if (isEffectAction(spec)) {
    return {
      label,
      variant,
      onClick: () => {
        applyEffect(spec.effect, undefined);
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
 * `DataTable`. Card chrome frames with `BlockFrame` + `BindingStates`; list
 * chrome is title + DataTable toolbar (arg filters + Plus add) with no Card.
 */
function CollectionBody({
  title,
  i18n,
  query,
  rowWhen,
  columns,
  actions,
  subjectType,
  subjectIdField = '_id',
  subjectUpload,
  subjectOutcome,
  defaultExpandWhen,
  perPage,
  filters,
  emptyState,
  addAction,
  addActionPlacement = 'toolbar',
  chrome = 'card',
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
  const { locale } = useLocale();
  const applyEffect = useActionEffect();
  const getRowId = useBoundRowIds();
  const [addFormOpen, setAddFormOpen] = useState(false);
  const addFormFields =
    addAction && !isEffectAction(addAction)
      ? addAction.form?.fields
      : undefined;
  const boundAddAction = useBoundAddAction(
    addAction,
    addFormFields ? () => setAddFormOpen(true) : undefined,
  );
  const listChrome = chrome === 'list';
  // `above` lifts the create button out of the card into its own row; the
  // toolbar then carries no add action. List chrome always uses the toolbar.
  const aboveCard = !listChrome && addActionPlacement === 'above';
  const tableAddAction =
    aboveCard || !boundAddAction
      ? undefined
      : { ...boundAddAction, icon: Plus };

  const clientFilters = (filters ?? []).filter((f) => f.mode === 'client');

  // `rowWhen` drops rows BEFORE the list page sees them, so search, facets,
  // and the empty state all operate on the visible set (ExternalList's
  // contract). Evaluated per row via the shared when_predicate grammar.
  const visibleDataSource = useMemo<CollectionDataSource>(() => {
    if (!rowWhen) return dataSource;
    if (dataSource.type === 'paginated') {
      return {
        ...dataSource,
        results: dataSource.results.filter((row) => evaluateWhen(rowWhen, row)),
      };
    }
    return {
      ...dataSource,
      data: dataSource.data?.filter((row) => evaluateWhen(rowWhen, row)),
    };
  }, [dataSource, rowWhen]);

  const { tableProps, isLoading } = useListPage<BoundRow>({
    dataSource: visibleDataSource,
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
            definitions: clientFilters.map((f) => {
              const facetValueLabels = resolveValueLabels(
                f.valueLabels,
                f.i18n,
                locale,
              );
              return {
                key: f.field,
                title:
                  resolveLocalizedProp(f.labelKey, f.i18n, 'label', locale) ??
                  f.labelKey ??
                  f.field,
                options: f.values.map((v) => ({
                  value: v,
                  // Facet display labels — the raw value stays the facet key.
                  label: facetValueLabels?.[v] ?? v,
                })),
              };
            }),
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
        locale,
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
        actionsGate: subjectType
          ? {
              idField: subjectIdField,
              render: (subjectId, cluster) => (
                <SubjectAwaitingInputActions
                  subjectType={subjectType}
                  subjectId={subjectId}
                  cluster={cluster}
                />
              ),
            }
          : undefined,
      }),
    // When columns are declared, row data churn must not rebuild column defs —
    // that remounts BoundButton cells and drops in-flight latch state.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- omit `rows` when columns declared so BoundButton latch survives query refresh
    hasDeclaredColumns
      ? [columns, actions, subjectType, subjectIdField, locale]
      : [columns, actions, subjectType, subjectIdField, locale, rows],
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

  const resolvedTitle =
    resolveLocalizedProp(title, i18n, 'title', locale) ?? title;

  // Rows born expanded (once): the fresh-row predicate over the loaded set.
  const autoExpandRowIds = useMemo(() => {
    if (!defaultExpandWhen) return undefined;
    return rows
      .filter((row) => evaluateWhen(defaultExpandWhen, row))
      .map((row) => getRowId(row));
  }, [defaultExpandWhen, rows, getRowId]);

  const addFormDialog =
    addAction && !isEffectAction(addAction) && addFormFields ? (
      <AddActionFormDialog
        action={addAction}
        fields={addFormFields}
        open={addFormOpen}
        onOpenChange={setAddFormOpen}
      />
    ) : null;

  // The lifted create button (placement `above`) — its own right-aligned row
  // over the card, so it reads as a view-level action, not a table control.
  const aboveAction =
    aboveCard && boundAddAction && !blocked && !needsConfig ? (
      <Row justify="end">
        <Button
          variant={boundAddAction.variant ?? 'primary'}
          disabled={boundAddAction.disabled}
          onClick={boundAddAction.onClick}
        >
          {boundAddAction.label}
        </Button>
      </Row>
    ) : null;

  const showFilterBar = !blocked && !needsConfig;
  const table = (
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
            // convergence button). List chrome keeps the same contract.
            infiniteScroll: { ...infinite, autoLoad: false },
          }
        : {})}
      emptyState={{
        title: emptyState?.titleKey ?? t('binding.empty'),
        description: emptyState?.descriptionKey,
      }}
      addAction={tableAddAction}
      filtersContent={listChrome && showFilterBar ? filterBar : undefined}
      enableExpanding={subjectType !== undefined || subjectUpload !== undefined}
      autoExpandRowIds={autoExpandRowIds}
      renderExpandedRow={
        subjectType !== undefined || subjectUpload !== undefined
          ? (row) => {
              const folderRaw = subjectUpload
                ? row.original[subjectUpload.folderIdField]
                : undefined;
              // `folderExists === false` = the bound folder was deleted
              // (the query stamps it); the card then shows a recover/remove
              // notice instead of a doomed upload zone.
              const orphaned = row.original.folderExists === false;
              const inputCard =
                typeof folderRaw === 'string' ? (
                  <FolderUploadCard folderId={folderRaw} orphaned={orphaned} />
                ) : undefined;
              const rawId = subjectType
                ? row.original[subjectIdField]
                : undefined;
              if (subjectType && typeof rawId === 'string') {
                return (
                  <SubjectRun
                    subjectType={subjectType}
                    subjectId={rawId}
                    input={inputCard}
                    promisedOutcomes={subjectOutcome?.promises}
                  />
                );
              }
              return inputCard ? <div className="pt-3">{inputCard}</div> : null;
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
  );

  const bindingBody = (
    <BindingStates
      blocked={blocked}
      path={query.path}
      needsConfig={needsConfig && !awaitingState && !needsProject}
      needsProject={needsProject}
      awaitingState={awaitingState}
    >
      {table}
    </BindingStates>
  );

  if (listChrome) {
    return (
      <VStack gap={3}>
        {resolvedTitle ? (
          <Text as="h3" className="font-semibold">
            {resolvedTitle}
          </Text>
        ) : null}
        {bindingBody}
        {addFormDialog}
      </VStack>
    );
  }

  const card = (
    <BlockFrame
      title={resolvedTitle}
      icon={resolvedTitle ? ListChecks : undefined}
      actions={showFilterBar ? filterBar : undefined}
    >
      {bindingBody}
      {addFormDialog}
    </BlockFrame>
  );

  if (!aboveAction) return card;
  return (
    <VStack gap={3}>
      {aboveAction}
      {card}
    </VStack>
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
  // Optional visibility gate (same grammar as Form/Text/Alert): when the
  // predicate is false the whole block — list AND its create action — is
  // hidden, so a pack can withhold it until a precondition holds (e.g. the
  // desk hides the returns list until the company Setup exists). Hooks run
  // unconditionally; the gate only changes what we return.
  const whenGate = useBlockWhenGate(props.when, props.whenQuery);

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

  if (whenGate.decision === 'pending' || whenGate.decision === 'hide') {
    return null;
  }
  if (whenGate.decision === 'needsConfig') {
    return whenGate.needsProject ? (
      <BlockFrame title={props.title}>
        <BindingStates needsProject>{null}</BindingStates>
      </BlockFrame>
    ) : null;
  }

  return props.perPage !== undefined ? (
    <CollectionPaginated {...props} query={query} filterBar={filterBar} />
  ) : (
    <CollectionSingle {...props} query={query} filterBar={filterBar} />
  );
}
