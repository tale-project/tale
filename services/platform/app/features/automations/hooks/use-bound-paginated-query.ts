'use client';

/**
 * Generic, capability-gated CURSOR-PAGINATED reactive read — the paginating
 * sibling of `useBoundQuery`. Same allowlist gate + `$orgId`/`$projectId`/
 * `$config:` arg resolution, but routed through Convex `usePaginatedQuery` (via
 * the cached wrapper) so a query-sourced list grows page-by-page behind a
 * "Load more" button while staying a LIVE subscription — new/updated rows appear
 * without a refetch (the decisive reason to paginate a query here rather than
 * reuse the action-infinite hook, which would lose reactivity).
 *
 * The view authors only the data args (e.g. `{ projectId, externalSystem }`);
 * `paginationOpts` is injected by `usePaginatedQuery`, so the resolved args must
 * NOT carry it. An unset `$config:`/`$projectId` binding resolves to `undefined`;
 * the hook gates on a fully-bound result and reports `needsConfig` instead of
 * firing a malformed request — same posture as `useBoundActionInfiniteQuery`.
 *
 * Also gates on the Convex WebSocket auth being established (`useConvexAuth`),
 * mirroring `useConvexQuery`'s default `requireAuth`: the raw
 * `usePaginatedQuery` underneath is NOT auth-aware and would otherwise fire
 * during an auth gap; the resulting server error is RETHROWN into render by
 * the Convex client and permanently trips the block's error boundary.
 */
import { useConvexAuth } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { useMemo } from 'react';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import type {
  PaginatedQueryArgs,
  PaginatedQueryReference,
} from '@/app/hooks/use-convex-paginated-query';
import {
  bindingArgsResolved,
  isFunctionAllowed,
  isValidFunctionPath,
  resolveBindingArgs,
} from '@/lib/shared/platform/function_bindings';
import { isRecord } from '@/lib/utils/type-utils';

import { useAutomationRuntime } from '../runtime/automation-runtime';
import { useOptionalViewState } from '../runtime/view-state';

export type BoundPaginatedStatus =
  | 'LoadingFirstPage'
  | 'CanLoadMore'
  | 'LoadingMore'
  | 'Exhausted';

export interface BoundPaginatedQueryResult {
  /** Accumulated rows across loaded pages (record-filtered). */
  results: Record<string, unknown>[];
  status: BoundPaginatedStatus;
  isLoading: boolean;
  /** Load the next `numItems` rows (Convex's own stable ref). */
  loadMore: (numItems: number) => void;
  /** The path was not in the automation's allowlist (or malformed) — nothing was called. */
  blocked: boolean;
  /** A `$config:`/`$projectId` binding the args reference is still unset, so no
   *  call fired — the automation needs configuration before this list can load. */
  needsConfig: boolean;
}

const DEFAULT_PER_PAGE = 50;

export function useBoundPaginatedQuery(
  path: string,
  args: unknown,
  options: { perPage?: number } = {},
): BoundPaginatedQueryResult {
  const { organizationId, projectId, allowlist, config } =
    useAutomationRuntime();
  const { isAuthenticated } = useConvexAuth();
  const viewState = useOptionalViewState();
  const state = viewState?.state;
  const allowed =
    isValidFunctionPath(path) && isFunctionAllowed(path, allowlist, 'query');

  const argsKey = JSON.stringify(args ?? {});
  const configKey = JSON.stringify(config ?? {});
  const stateKey = JSON.stringify(state ?? {});
  // Resolve the data args ONCE (for the gate + the subscription). An unset
  // `$config:`/`$state.` reference resolves to `undefined`; gate on a
  // fully-bound result.
  const resolved = useMemo(
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
  const ready = bindingArgsResolved(resolved);

  // A runtime-path query reference can't structurally satisfy the generic
  // `PaginatedQueryReference` conditional (nor its `PaginatedQueryArgs`), so
  // assert both — same precedent as `useBoundActionInfiniteQuery`'s
  // `makeFunctionReference<'action'>` cast and `primeCachedPaginatedQuery`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime path ref can't satisfy the generic PaginatedQueryReference structurally
  const ref = makeFunctionReference<'query'>(
    path,
  ) as unknown as PaginatedQueryReference;
  // `isAuthenticated` folds into the skip like `useConvexQuery`'s `requireAuth`
  // default: pre-auth the subscription stays unfired (skeleton via
  // `LoadingFirstPage`) instead of erroring server-side.
  const queryArgs =
    allowed && ready && isAuthenticated
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- resolved data args (paginationOpts injected by the hook) match the query's non-pagination args
        (resolved as PaginatedQueryArgs<PaginatedQueryReference>)
      : 'skip';

  const result = useCachedPaginatedQuery(ref, queryArgs, {
    initialNumItems: options.perPage ?? DEFAULT_PER_PAGE,
  });

  return {
    results: result.results.filter(isRecord),
    status: result.status,
    isLoading: allowed && ready ? result.isLoading : false,
    loadMore: result.loadMore,
    blocked: !allowed,
    needsConfig: allowed && !ready,
  };
}
