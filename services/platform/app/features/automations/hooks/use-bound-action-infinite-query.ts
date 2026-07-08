'use client';

/**
 * Generic, capability-gated CACHED + PAGINATED read from an action — the
 * accumulating sibling of `useBoundActionQuery`. Same allowlist gate + `$orgId`
 * arg resolution + `staleTime: Infinity` warmth, but routed through TanStack
 * `useInfiniteQuery` so an action-sourced list grows page-by-page (each page
 * cached under one query key) instead of replacing one page with the next.
 *
 * This exists so a list whose rows are filtered CLIENT-side (e.g. GitHub issues
 * minus the ones already turned into tasks) can keep pulling pages until it has
 * visible rows: a single fixed page can filter to empty even when later pages
 * have matches, so "page N of raw rows" is the wrong model — accumulate instead.
 *
 * `perPage` is optional: omit it and the action is called once with no
 * `page`/`perPage` args (a plain single-shot read, `getNextPageParam` → no next
 * page), so a non-paginated list behaves exactly like `useBoundActionQuery`.
 *
 * Refresh is explicit (`refetch()` re-fetches every loaded page). The queryKey
 * folds in `organizationId`/`projectId` so different orgs/projects never share a
 * cache entry even though the unresolved args carry the same sentinels.
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAction, useConvexAuth } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { useMemo } from 'react';

import { isStructuredConvexError } from '@/app/hooks/use-action-query';
import {
  bindingArgsResolved,
  isFunctionAllowed,
  isValidFunctionPath,
  resolveBindingArgs,
} from '@/lib/shared/platform/function_bindings';
import { isRecord } from '@/lib/utils/type-utils';

import { useAutomationRuntime } from '../runtime/automation-runtime';
import { useOptionalViewState } from '../runtime/view-state';

/** Extract the rows array + a next-page hint from one action result. */
export function parsePage(
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
  const raw = (fromKey ??
    fallback ??
    (Array.isArray(result) ? result : [])) as unknown[];
  const rows = raw.filter(isRecord);
  const pagination = isRecord(wrapper) ? wrapper.pagination : undefined;
  // The "a full page came back" fallback must count the RAW page length, not the
  // post-`isRecord` `rows`: a full page carrying any non-record entry would
  // otherwise under-count and dead-end pagination one page early.
  const hasNext =
    isRecord(pagination) && typeof pagination.hasNextPage === 'boolean'
      ? pagination.hasNextPage
      : perPage !== undefined && raw.length >= perPage;
  return { rows, hasNext };
}

/** Opaque pagination cursor the source action echoes back; passed through verbatim. */
export type InfiniteCursor = Record<string, unknown>;

/** Read the next-page cursor from one action result (unwrapping the envelope). */
export function nextCursorOf(result: unknown): InfiniteCursor | undefined {
  const wrapper =
    isRecord(result) && isRecord(result.result) ? result.result : result;
  const pagination = isRecord(wrapper) ? wrapper.pagination : undefined;
  const cursor = isRecord(pagination) ? pagination.nextCursor : undefined;
  return isRecord(cursor) ? cursor : undefined;
}

export interface BoundActionInfiniteQueryResult {
  /** Raw, unparsed action results — one per fetched page. */
  pages: unknown[];
  isLoading: boolean;
  /** True while any page (initial, refetch, or next) is in flight. */
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: Error | null;
  /** Stable across renders (TanStack's own ref), so it's safe in effect deps. */
  fetchNextPage: () => void;
  refetch: () => void;
  /** The path was not in the automation's allowlist (or malformed) — nothing was called. */
  blocked: boolean;
  /** A `$config:` (or other) binding the args reference is still unset, so no
   *  call fired — the automation needs configuration before this list can load. */
  needsConfig: boolean;
}

export function useBoundActionInfiniteQuery(
  path: string,
  args: unknown,
  options: { perPage?: number } = {},
): BoundActionInfiniteQueryResult {
  const { perPage } = options;
  const { organizationId, projectId, allowlist, config } =
    useAutomationRuntime();
  const viewState = useOptionalViewState();
  const state = viewState?.state;
  const { isAuthenticated } = useConvexAuth();
  const allowed =
    isValidFunctionPath(path) && isFunctionAllowed(path, allowlist, 'action');

  // Hooks run unconditionally; `enabled` (not the ref) gates the actual call.
  const action = useAction(makeFunctionReference<'action'>(path));
  const argsKey = JSON.stringify(args ?? {});
  // Resolved args embed config values (e.g. owner/repo), so a config change must
  // bust the cache — fold it into the key. Same for `$state.` selections.
  const configKey = JSON.stringify(config ?? {});
  const stateKey = JSON.stringify(state ?? {});

  // Resolve the source args ONCE (for the gate + the per-page calls). An unset
  // `$config:`/`$state.` reference resolves to `undefined`; gate on a
  // fully-bound result so an unconfigured automation shows a prompt instead of firing
  // a call that fails arg validation. `page`/`cursor` are plain values spread
  // on per fetch, not args sentinels, so they don't affect resolution.
  const resolvedBase = useMemo(
    () =>
      resolveBindingArgs(isRecord(args) ? args : {}, {
        organizationId,
        projectId,
        config,
        state,
      }),
    // argsKey/configKey/stateKey stand in for the structurally-compared args +
    // config + view state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [argsKey, configKey, stateKey, organizationId, projectId],
  );
  const ready = bindingArgsResolved(resolvedBase);

  const query = useInfiniteQuery({
    // projectId folded in alongside organizationId so two projects never share a
    // cache entry even though the unresolved args carry the same sentinels.
    queryKey: [
      'bound-action-infinite-query',
      path,
      organizationId,
      projectId,
      argsKey,
      configKey,
      stateKey,
      perPage ?? null,
    ],
    queryFn: ({ pageParam }) =>
      action(
        perPage !== undefined
          ? {
              ...(isRecord(resolvedBase) ? resolvedBase : {}),
              perPage,
              ...(pageParam ? { cursor: pageParam } : {}),
            }
          : resolvedBase,
      ),
    // The source action returns an opaque `pagination.nextCursor`; the first call
    // sends none (server starts from the beginning). No `perPage` ⇒ single-shot.
    initialPageParam: null as InfiniteCursor | null,
    getNextPageParam: (lastPage) =>
      perPage !== undefined ? (nextCursorOf(lastPage) ?? undefined) : undefined,
    staleTime: Infinity,
    // ConvexError is deterministic (validation / auth / expected-state) — don't
    // burn ~7s of retry backoff before the UI sees it. Network errors still retry.
    retry: (failureCount, err) =>
      !isStructuredConvexError(err) && failureCount < 3,
    enabled: allowed && isAuthenticated && ready,
  });

  return {
    pages: query.data?.pages ?? [],
    isLoading: allowed && ready ? query.isLoading : false,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    error: query.error,
    fetchNextPage: query.fetchNextPage,
    refetch: () => void query.refetch(),
    blocked: !allowed,
    needsConfig: allowed && !ready,
  };
}
