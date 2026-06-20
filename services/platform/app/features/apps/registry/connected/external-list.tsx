'use client';

/**
 * Connected `ExternalList` block — the action-sourced sibling of `Collection`.
 * Fetches rows one-shot from any allowlisted action (data that lives outside
 * Convex, e.g. a GitHub repo's issues) with a Refresh affordance and optional
 * pagination, then renders them through the shared `DataTable`. Generic: the
 * action path, its args, the columns, the per-row actions, and any row filter
 * are all view config — the block carries no scenario knowledge.
 *
 * Pagination is opt-in (set `perPage`); when on, the block sends `page`
 * (1-indexed) + `perPage` to the action and prefers the action's
 * `pagination.hasNextPage` flag, falling back to "a full page came back".
 */
import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { CircleDot } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { evaluateWhen } from '@/lib/shared/platform/when_predicate';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundAction } from '../../hooks/use-bound-action';
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
  /** Per-row actions, bound to the row via `BoundButton`. */
  actions?: BoundActionSpec[];
  /** Page size; when set, the block paginates (`page` + `perPage` args). */
  perPage?: number;
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

export function ExternalList({
  title,
  source,
  itemsKey,
  rowWhen,
  columns,
  actions,
  perPage,
}: ExternalListProps) {
  const { t } = useT('apps');
  const fetcher = useBoundAction(source.path, source.mode ?? 'action');
  // dispatch identity is unstable; read the latest via a ref so the fetch effect
  // depends only on the source params + page.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const paginated = perPage !== undefined;
  const sourceArgs = isRecord(source.args) ? source.args : {};
  const argsKey = JSON.stringify(sourceArgs);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current.dispatch({
        ...sourceArgs,
        ...(paginated ? { page, perPage } : {}),
      });
      const parsed = parsePage(result, itemsKey, perPage);
      setRows(parsed.rows);
      setHasNext(parsed.hasNext);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // sourceArgs is captured via argsKey to keep the dep list primitive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.path, argsKey, itemsKey, page, perPage, paginated]);

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

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  const visibleRows = rowWhen
    ? rows.filter((r) => evaluateWhen(rowWhen, r))
    : rows;

  const refresh = (
    <Button
      size="sm"
      variant="ghost"
      disabled={loading}
      onClick={() => void fetchPage()}
    >
      {t('list.refresh')}
    </Button>
  );

  return (
    <Section title={title} icon={CircleDot} action={refresh}>
      {loading && rows.length === 0 ? (
        <SkeletonText lines={3} />
      ) : error ? (
        <Text variant="error">{t('list.error', { error })}</Text>
      ) : (
        <>
          {visibleRows.length === 0 ? (
            <Text variant="muted">{t('binding.empty')}</Text>
          ) : (
            <DataTable rows={visibleRows} columns={columns} actions={actions} />
          )}
          {/* Pagination stays available even when this page filtered to zero
              visible rows (e.g. a whole page of rowWhen-excluded items), so the
              user can advance to a page that has matches instead of dead-ending. */}
          {paginated && (
            <HStack gap={3} className="items-center justify-end">
              <Button
                size="sm"
                variant="ghost"
                disabled={loading || page <= 1}
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
                disabled={loading || !hasNext}
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
