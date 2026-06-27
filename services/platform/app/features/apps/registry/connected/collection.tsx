'use client';

/**
 * Connected `Collection` block — binds an allowlisted query and renders its rows
 * as a table, with optional per-row actions. Generic: it shows whatever records
 * the bound query returns (columns specified, or inferred from the first row),
 * so any list query can drive it. The reactive binding lives here (Puck only
 * composes the block). Row rendering is delegated to the shared `DataTable`.
 *
 * Pagination is opt-in (set `perPage`): when on, the block reads through
 * `useBoundPaginatedQuery` (Convex cursor pagination, still a LIVE subscription)
 * and accumulates pages behind a "Load more" button; when off, it's a single
 * reactive read — the original contract, unchanged. The two paths live in
 * separate inner components so each calls exactly one data hook (no conditional
 * hooks, no wasted subscription).
 *
 * `filters` is opt-in too: each entry declares a `field` + its `values`, rendered
 * as a single-select dropdown that merges the chosen value into the bound query's
 * args (e.g. `status`). The field names + values live in view config (data), so
 * the block hardcodes no domain vocabulary.
 *
 * When `subjectType` is set, each row is expandable to show its workflow run
 * inline (`SubjectRun` → the reused execution view), so a domain list (tasks
 * now; others later) shows execution detail in-context — no separate run page.
 */
import { Button } from '@tale/ui/button';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { HStack, Row } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { ChevronDown, ListChecks } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundPaginatedQuery } from '../../hooks/use-bound-paginated-query';
import { useBoundQuery } from '../../hooks/use-bound-query';
import {
  resolveColumnLabels,
  usePackLabelString,
} from '../../runtime/app-runtime';
import { type BoundActionSpec } from './bound-button';
import { DataTable } from './data-table';
import { Section } from './section';
import { SubjectCapacityChip } from './subject-capacity-chip';
import { SubjectRun } from './subject-run';

/** One single-select filter: a query-arg/row `field` and its allowed `values`. */
export interface CollectionFilterSpec {
  field: string;
  values: string[];
  /** Optional `$label:` ref for the control's label (else the capitalized field). */
  labelKey?: string;
}

export interface CollectionProps {
  title?: string;
  query: { path: string; args?: unknown };
  /** Columns to show; if omitted, inferred from the first row (minus id-like keys). */
  columns?: string[];
  /** Header text per column key — each a `$label:` pack reference or literal. */
  columnLabels?: Record<string, string>;
  actions?: BoundActionSpec[];
  /** When set, rows expand to show their workflow run inline (the execution
   *  "about" this subject). Generic — any domain list opts in. */
  subjectType?: string;
  /** Row field holding the subject id (default `_id`). */
  subjectIdField?: string;
  /** Page size; when set, the block paginates (cursor) and accumulates pages
   *  behind a "Load more" button. Omit for a single-shot reactive read. */
  perPage?: number;
  /** Single-select filters merged into the bound query's args (e.g. `status`). */
  filters?: CollectionFilterSpec[];
}

/** Inner-component props: the (filter-merged) query + the rendered filter bar. */
type InnerCollectionProps = CollectionProps & { filterBar?: ReactNode };

/** Radio-group value standing for "no filter" (Radix items can't be empty). */
const ALL_FILTER_VALUE = '__all__';

function pickArray(data: unknown): Record<string, unknown>[] {
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

/** The status/field filter row — a single-select dropdown per declared filter. */
function CollectionFilterBar({
  filters,
  values,
  onChange,
}: {
  filters: CollectionFilterSpec[];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const { t } = useT('apps');
  const labelOf = usePackLabelString();
  return (
    <Row gap={2} wrap className="mb-3">
      {filters.map((f) => {
        const selected = values[f.field];
        const label = f.labelKey ? labelOf(f.labelKey) : f.field;
        return (
          <DropdownMenu
            key={f.field}
            trigger={
              <Button variant="secondary" size="sm">
                <span
                  className={cn(
                    'text-muted-foreground',
                    // Match DataTable's capitalize-the-raw-key fallback when the
                    // view didn't author a localized label.
                    !f.labelKey && 'capitalize',
                  )}
                >
                  {label}:
                </span>
                <span className="ml-1">{selected ?? t('list.all')}</span>
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
                    ...f.values.map((v) => ({ value: v, label: v })),
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

/** The shared row table for both Collection paths: applies the optional
 *  subject-row expansion + capacity-chip accessory and renders via `DataTable`.
 *  `maxRows` is passed through (paginated lists pass `rows.length` so accumulated
 *  pages aren't re-truncated; the single-shot list omits it → DataTable's default
 *  cap). */
function CollectionTable({
  rows,
  columns,
  resolvedColumnLabels,
  actions,
  subjectType,
  subjectIdField,
  maxRows,
}: {
  rows: Record<string, unknown>[];
  columns?: string[];
  resolvedColumnLabels?: Record<string, string>;
  actions?: BoundActionSpec[];
  subjectType?: string;
  subjectIdField: string;
  maxRows?: number;
}) {
  return (
    <DataTable
      rows={rows}
      columns={columns}
      columnLabels={resolvedColumnLabels}
      actions={actions}
      maxRows={maxRows}
      expansion={
        subjectType
          ? {
              idField: subjectIdField,
              render: (subjectId) => (
                <SubjectRun subjectType={subjectType} subjectId={subjectId} />
              ),
            }
          : undefined
      }
      rowAccessory={
        subjectType
          ? {
              idField: subjectIdField,
              render: (subjectId, statusBadge) => (
                <SubjectCapacityChip
                  subjectType={subjectType}
                  subjectId={subjectId}
                  fallback={statusBadge}
                />
              ),
            }
          : undefined
      }
    />
  );
}

/** Single-shot reactive read — the original Collection behavior. */
function CollectionSingle({
  title,
  query,
  columns,
  columnLabels,
  actions,
  subjectType,
  subjectIdField = '_id',
  filterBar,
}: InnerCollectionProps) {
  const { t } = useT('apps');
  const labelOf = usePackLabelString();
  const { data, isLoading, blocked } = useBoundQuery(query.path, query.args);
  const rows = pickArray(data);

  return (
    <Section title={labelOf(title)} icon={ListChecks}>
      {blocked ? (
        <Text variant="error">
          {t('binding.blocked', { path: query.path })}
        </Text>
      ) : (
        <>
          {filterBar}
          {isLoading && rows.length === 0 ? (
            <SkeletonText lines={3} />
          ) : rows.length === 0 ? (
            <Text variant="muted">{t('binding.empty')}</Text>
          ) : (
            <CollectionTable
              rows={rows}
              columns={columns}
              resolvedColumnLabels={resolveColumnLabels(columnLabels, labelOf)}
              actions={actions}
              subjectType={subjectType}
              subjectIdField={subjectIdField}
            />
          )}
        </>
      )}
    </Section>
  );
}

/** Cursor-paginated read: accumulates pages behind a "Load more" button while
 *  staying a live subscription. */
function CollectionPaginated({
  title,
  query,
  columns,
  columnLabels,
  actions,
  subjectType,
  subjectIdField = '_id',
  perPage,
  filterBar,
}: InnerCollectionProps) {
  const { t } = useT('apps');
  const labelOf = usePackLabelString();
  const { results, status, loadMore, blocked, needsConfig } =
    useBoundPaginatedQuery(query.path, query.args, { perPage });

  return (
    <Section title={labelOf(title)} icon={ListChecks}>
      {blocked ? (
        <Text variant="error">
          {t('binding.blocked', { path: query.path })}
        </Text>
      ) : needsConfig ? (
        // A `$config:`/`$projectId` binding the query references is still unset —
        // prompt to configure rather than firing a request that would fail arg
        // validation.
        <Text variant="muted">{t('list.needsConfig')}</Text>
      ) : (
        <>
          {filterBar}
          {status === 'LoadingFirstPage' ? (
            <SkeletonText lines={3} />
          ) : results.length === 0 ? (
            <Text variant="muted">{t('binding.empty')}</Text>
          ) : (
            <>
              <CollectionTable
                rows={results}
                columns={columns}
                resolvedColumnLabels={resolveColumnLabels(
                  columnLabels,
                  labelOf,
                )}
                actions={actions}
                subjectType={subjectType}
                subjectIdField={subjectIdField}
                // Render the whole accumulated list — the default 50-row cap
                // would silently swallow rows pulled in by "Load more".
                maxRows={results.length}
              />
              {(status === 'CanLoadMore' || status === 'LoadingMore') && (
                <HStack gap={3} className="items-center justify-center">
                  <Button
                    variant="ghost"
                    disabled={status === 'LoadingMore'}
                    onClick={() => loadMore(perPage ?? 50)}
                  >
                    {status === 'LoadingMore'
                      ? t('list.loadingMore')
                      : t('list.loadMore')}
                  </Button>
                </HStack>
              )}
            </>
          )}
        </>
      )}
    </Section>
  );
}

export function Collection(props: CollectionProps) {
  // Filter state lives once here and is merged into the bound query's args, so
  // both inner paths get a filtered query + the same filter bar. `perPage` and
  // `filters` come from view config and never change at runtime, so picking the
  // path here is stable — each inner component owns a consistent hook set.
  const filters = props.filters ?? [];
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});

  const baseArgs = isRecord(props.query.args) ? props.query.args : {};
  const query =
    filters.length > 0
      ? { path: props.query.path, args: { ...baseArgs, ...filterValues } }
      : props.query;
  const filterBar =
    filters.length > 0 ? (
      <CollectionFilterBar
        filters={filters}
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
