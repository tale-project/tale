'use client';

/**
 * Connected `ExternalList` block — the action-sourced sibling of `Collection`.
 * Fetches rows from any allowlisted action (data that lives outside Convex, e.g.
 * a GitHub repo's issues) through a CACHED query (`useBoundActionQuery`,
 * `staleTime: Infinity`) so re-entering the tab/page serves the cache instead of
 * re-hitting upstream on every mount; an explicit Refresh re-fetches. Renders
 * through the shared `DataTable`. Generic: the action path, its args, the
 * columns, the per-row actions, any row filter, and an optional cross-reference
 * exclusion are all view config — the block carries no scenario knowledge.
 *
 * Pagination is opt-in (set `perPage`); when on, the block sends `page`
 * (1-indexed) + `perPage` to the action and prefers the action's
 * `pagination.hasNextPage` flag, falling back to "a full page came back". Each
 * page is cached under its own key, so paging back is instant.
 *
 * `excludeBy` (optional) hides rows already materialized into a Convex table:
 * it binds a reactive query and drops any row whose `rowKeyTemplate` matches a
 * key the query already holds (e.g. an issue whose task already exists). Because
 * the query is reactive, creating that task hides the row live.
 */
import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { CircleDot } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { excludeExisting } from '@/lib/shared/platform/exclude_by';
import { evaluateWhen } from '@/lib/shared/platform/when_predicate';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundActionQuery } from '../../hooks/use-bound-action-query';
import { useBoundQuery } from '../../hooks/use-bound-query';
import {
  resolveColumnLabels,
  usePackLabelString,
} from '../../runtime/app-runtime';
import { type BoundActionSpec } from './bound-button';
import { DataTable } from './data-table';
import { Section } from './section';

export interface ExternalListProps {
  title?: string;
  /** The allowlisted action to fetch rows from (mode defaults to `action`). */
  source: { path: string; args?: unknown; mode?: 'action' };
  /** Result key holding the rows array (e.g. `data`); else a common wrapper key. */
  itemsKey?: string;
  /** Client-side row filter (when_predicate grammar), e.g. `!pull_request`. */
  rowWhen?: string;
  /** Columns to show; if omitted, inferred from the first row. */
  columns?: string[];
  /** Header text per column key — each a `$label:` pack reference or literal. */
  columnLabels?: Record<string, string>;
  /** Per-row actions, bound to the row via `BoundButton`. */
  actions?: BoundActionSpec[];
  /** Page size; when set, the block paginates (`page` + `perPage` args). */
  perPage?: number;
  /**
   * Cross-reference exclusion: hide rows already represented in another Convex
   * collection. `query` is an allowlisted reactive query whose rows hold the
   * join key in `refField`; a source row is dropped when `rowKeyTemplate`
   * (a `{field}` template over the row) resolves to one of those keys.
   */
  excludeBy?: {
    query: { path: string; args?: unknown };
    refField: string;
    rowKeyTemplate: string;
  };
}

/** Extract the rows array + a next-page hint from the action result. */
function parsePage(
  result: unknown,
  itemsKey: string | undefined,
  perPage: number | undefined,
): { rows: Record<string, unknown>[]; hasNext: boolean } {
  // The action layer commonly wraps as `{ result: { data, pagination } }`.
  const wrapper =
    isRecord(result) && isRecord(result.result) ? result.result : result;
  const fromKey =
    itemsKey && isRecord(wrapper) && Array.isArray(wrapper[itemsKey])
      ? wrapper[itemsKey]
      : undefined;
  const fallback = isRecord(wrapper)
    ? ['data', 'items', 'rows', 'records', 'results', 'page']
        .map((k) => wrapper[k])
        .find(Array.isArray)
    : undefined;
  const raw = fromKey ?? fallback ?? (Array.isArray(result) ? result : []);
  const rows = (raw as unknown[]).filter(isRecord);
  const pagination = isRecord(wrapper) ? wrapper.pagination : undefined;
  const hasNext =
    isRecord(pagination) && typeof pagination.hasNextPage === 'boolean'
      ? pagination.hasNextPage
      : perPage !== undefined && rows.length >= perPage;
  return { rows, hasNext };
}

/** Pull the rows array out of a bound-query result (array or common wrapper key). */
function pickRefRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (isRecord(data)) {
    for (const key of [
      'tasks',
      'items',
      'rows',
      'records',
      'results',
      'page',
    ]) {
      const v = data[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export function ExternalList({
  title,
  source,
  itemsKey,
  rowWhen,
  columns,
  columnLabels,
  actions,
  perPage,
  excludeBy,
}: ExternalListProps) {
  const { t } = useT('apps');
  const labelOf = usePackLabelString();

  const [page, setPage] = useState(1);
  const paginated = perPage !== undefined;
  const sourceArgs = isRecord(source.args) ? source.args : {};
  const argsKey = JSON.stringify(sourceArgs);

  const query = useBoundActionQuery(source.path, {
    ...sourceArgs,
    ...(paginated ? { page, perPage } : {}),
  });

  const { rows, hasNext } = parsePage(query.data, itemsKey, perPage);

  // Reactive cross-reference source (skips when no `excludeBy` — invalid path).
  const refQuery = useBoundQuery(
    excludeBy?.query.path ?? '',
    excludeBy?.query.args,
  );

  // Reset to page 1 when the query identity changes, so a changed source never
  // starts mid-pagination on a page that may not exist for the new query.
  const queryKey = `${source.path}|${argsKey}|${perPage ?? ''}`;
  const prevQueryKey = useRef(queryKey);
  useEffect(() => {
    if (prevQueryKey.current !== queryKey) {
      prevQueryKey.current = queryKey;
      setPage(1);
    }
  }, [queryKey]);

  const visibleRows = useMemo(() => {
    const filtered = rowWhen
      ? rows.filter((r) => evaluateWhen(rowWhen, r))
      : rows;
    if (!excludeBy) return filtered;
    return excludeExisting(
      filtered,
      pickRefRows(refQuery.data),
      excludeBy.refField,
      excludeBy.rowKeyTemplate,
    );
  }, [rows, rowWhen, excludeBy, refQuery.data]);

  const refresh = (
    <Button
      size="sm"
      variant="ghost"
      disabled={query.isFetching}
      onClick={() => query.refetch()}
    >
      {t('list.refresh')}
    </Button>
  );

  return (
    <Section title={labelOf(title)} icon={CircleDot} action={refresh}>
      {query.blocked ? (
        <Text variant="error">
          {t('binding.blocked', { path: source.path })}
        </Text>
      ) : query.isLoading && rows.length === 0 ? (
        <SkeletonText lines={3} />
      ) : query.error ? (
        <Text variant="error">
          {t('list.error', { error: query.error.message })}
        </Text>
      ) : (
        <>
          {visibleRows.length === 0 ? (
            <Text variant="muted">{t('binding.empty')}</Text>
          ) : (
            <DataTable
              rows={visibleRows}
              columns={columns}
              columnLabels={resolveColumnLabels(columnLabels, labelOf)}
              actions={actions}
            />
          )}
          {/* Pagination stays available even when this page filtered to zero
              visible rows (e.g. a whole page of rowWhen/excludeBy-excluded
              items), so the user can advance to a page that has matches instead
              of dead-ending. */}
          {paginated && (
            <HStack gap={3} className="items-center justify-end">
              <Button
                size="sm"
                variant="ghost"
                disabled={query.isFetching || page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('list.prev')}
              </Button>
              <Text variant="muted" className="text-sm">
                {t('list.page', { page })}
              </Text>
              <Button
                size="sm"
                variant="ghost"
                disabled={query.isFetching || !hasNext}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('list.next')}
              </Button>
            </HStack>
          )}
        </>
      )}
    </Section>
  );
}
