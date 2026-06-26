'use client';

/**
 * Connected `ExternalList` block — the action-sourced sibling of `Collection`.
 * Fetches rows from any allowlisted action (data that lives outside Convex, e.g.
 * a GitHub repo's issues) through a CACHED query (`staleTime: Infinity`) so
 * re-entering the tab/page serves the cache instead of re-hitting upstream on
 * every mount; an explicit Refresh re-fetches. Renders through the shared
 * `DataTable`. Generic: the action path, its args, the columns, the per-row
 * actions, any row filter, and an optional cross-reference exclusion are all
 * view config — the block carries no scenario knowledge.
 *
 * Pagination is opt-in (set `perPage`); when on, the block ACCUMULATES pages via
 * `useBoundActionInfiniteQuery` (each cached under one cursor key) and renders
 * them as a single growing list behind a "Load more" button. The source action
 * owns FILTERED pagination: it returns a full page of already-visible rows plus
 * an opaque `pagination.nextCursor`, so "page 1" is genuinely a full page (the
 * first paint is never a misleadingly-empty page of already-handled rows) and
 * the cursor is a true end-of-stream signal.
 *
 * `rowWhen` (optional) drops rows client-side by predicate; `excludeBy`
 * (optional) hides rows already materialized into a Convex table — it binds a
 * reactive query and drops any row whose `rowKeyTemplate` matches a key the
 * query already holds (e.g. an issue whose task already exists). When the source
 * already filters server-side, these stay on as a thin LIVE top-up: because the
 * exclude query is reactive, creating the task hides the row immediately, without
 * waiting for a refetch.
 */
import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { CircleDot } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { convexErrorCode } from '@/app/hooks/use-action-query';
import { useT } from '@/lib/i18n/client';
import { excludeExisting } from '@/lib/shared/platform/exclude_by';
import { evaluateWhen } from '@/lib/shared/platform/when_predicate';
import { isRecord } from '@/lib/utils/type-utils';

import {
  parsePage,
  useBoundActionInfiniteQuery,
} from '../../hooks/use-bound-action-infinite-query';
import { useBoundQuery } from '../../hooks/use-bound-query';
import { useAppRuntime } from '../../runtime/app-runtime';
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
  /** Page size; when set, the block paginates (`page` + `perPage` args) and
   *  accumulates pages behind a "Load more" button. */
  perPage?: number;
  /**
   * Cross-reference exclusion: hide rows already represented in another Convex
   * collection. `query` is an allowlisted reactive query; a source row is dropped
   * when `rowKeyTemplate` (a `{field}` template over the row) resolves to one of
   * the query's keys. `refField` names the key field when the query returns
   * records; omit it when the query returns the keys directly (a bare string[]).
   */
  excludeBy?: {
    query: { path: string; args?: unknown };
    refField?: string;
    rowKeyTemplate: string;
  };
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
  const { config } = useAppRuntime();

  const paginated = perPage !== undefined;
  const query = useBoundActionInfiniteQuery(source.path, source.args, {
    perPage,
  });

  // Flatten every loaded page into one raw-row list (a single page when not
  // paginated). The page identity is the cache, so changing the source resets it.
  const rows = useMemo(
    () => query.pages.flatMap((p) => parsePage(p, itemsKey, perPage).rows),
    [query.pages, itemsKey, perPage],
  );

  // Reactive cross-reference source (skips when no `excludeBy` — invalid path).
  const refQuery = useBoundQuery(
    excludeBy?.query.path ?? '',
    excludeBy?.query.args,
  );

  const visibleRows = useMemo(() => {
    const filtered = rowWhen
      ? rows.filter((r) => evaluateWhen(rowWhen, r))
      : rows;
    if (!excludeBy) return filtered;
    return excludeExisting(
      filtered,
      pickRefRows(refQuery.data),
      excludeBy.refField ?? '',
      excludeBy.rowKeyTemplate,
      config,
    );
  }, [rows, rowWhen, excludeBy, refQuery.data, config]);

  // The source returns a FULL page of already-visible rows, so the block never
  // has to chase a probabilistically-empty page. The reactive `excludeBy` can
  // still hide a row the user just materialized; if that empties the loaded set
  // while real pages remain, pull the next one. Bounded by `hasNextPage` — a true
  // end-of-stream signal from the cursor — so it can neither loop forever nor
  // dead-end, and gated on `!query.error` so a failed fetch surfaces instead of
  // re-firing in a tight loop.
  const { fetchNextPage, hasNextPage, isFetching } = query;
  const needMore =
    paginated && visibleRows.length === 0 && hasNextPage && !query.error;
  useEffect(() => {
    if (needMore && !isFetching) fetchNextPage();
  }, [needMore, isFetching, fetchNextPage]);

  const refresh = (
    <Button
      variant="ghost"
      disabled={isFetching}
      onClick={() => query.refetch()}
    >
      {t('list.refresh')}
    </Button>
  );

  // Still hunting for the first visible rows (initial load, a top-up in flight,
  // or one about to fire) — show a skeleton, never a premature empty state that
  // would flash before the next page arrives.
  const searching =
    query.isLoading || needMore || (isFetching && visibleRows.length === 0);

  return (
    <Section title={labelOf(title)} icon={CircleDot} action={refresh}>
      {query.blocked ? (
        <Text variant="error">
          {t('binding.blocked', { path: source.path })}
        </Text>
      ) : query.needsConfig ? (
        // A `$config:` the source binds is still unset — the app hasn't been
        // pointed at a target yet. Prompt to configure rather than firing a
        // request that would fail arg validation.
        <Text variant="muted">{t('list.needsConfig')}</Text>
      ) : searching ? (
        <SkeletonText lines={3} />
      ) : query.error && visibleRows.length === 0 ? (
        // Only surface the full error state when nothing is VISIBLE: with
        // accumulation a failed "Load more" must not wipe the rows already on
        // screen. Keyed on `visibleRows` (not raw `rows`) so a hard error whose
        // pages all filter to empty shows the error instead of a calm "empty".
        // A not-connected integration is an expected state, not a failure:
        // render a calm prompt to connect it rather than a red server error.
        convexErrorCode(query.error) === 'INTEGRATION_NOT_CONNECTED' ? (
          <Text variant="muted">{t('list.notConnected')}</Text>
        ) : (
          <Text variant="error">
            {t('list.error', { error: query.error.message })}
          </Text>
        )
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
              // Render the whole accumulated, filtered list — the default 50-row
              // cap would silently swallow rows pulled in by "Load more".
              maxRows={visibleRows.length}
            />
          )}
          {/* A failed "Load more" keeps the rows above on screen, but must not
              fail silently — surface the error inline so the user knows the click
              didn't take and can retry via the button below. */}
          {paginated && query.error && visibleRows.length > 0 && (
            <Text variant="error" className="text-sm">
              {t('list.error', { error: query.error.message })}
            </Text>
          )}
          {paginated && hasNextPage && (
            <HStack gap={3} className="items-center justify-center">
              <Button
                variant="ghost"
                disabled={isFetching}
                onClick={() => fetchNextPage()}
              >
                {isFetching ? t('list.loadingMore') : t('list.loadMore')}
              </Button>
            </HStack>
          )}
        </>
      )}
    </Section>
  );
}
