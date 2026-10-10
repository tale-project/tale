import type { QueryClient } from '@tanstack/react-query';

import {
  activeOrganizationId,
  PAGINATED_ADAPTERS,
  projectAdaptedRead,
  READ_ADAPTERS,
  retryAdaptedRead,
  runAdapted,
  type AdaptedPage,
  type AdaptedPaginatedOptions,
} from './adapters';
import type { ArgsOf, PaginatedName, QueryName, ReturnsOf } from './contract';
import { MissingBackendRowError } from './missing-row';

/**
 * Route-loader prefetch that respects the adapter seam.
 *
 * A loader's job is to have the answer in the cache under the SAME key the
 * component will read, so the first paint has no skeleton flash — which means
 * going through the adapter row the component's own `useBackendQuery` will use,
 * never a second lane of its own.
 */
export function prefetchAdaptedQuery<Name extends QueryName>(
  queryClient: QueryClient,
  name: Name,
  args: ArgsOf<Name>,
): void {
  const adapter = READ_ADAPTERS[name];
  if (adapter !== undefined) {
    const orgId = activeOrganizationId();
    const adapted = adapter(
      args,
      orgId !== undefined ? { organizationId: orgId } : {},
    );
    // `null` = the row cannot serve these args yet (no org in scope); the
    // component's own render will ask again once it can.
    if (adapted !== null) {
      void queryClient.prefetchQuery({
        queryKey: adapted.queryKey,
        queryFn: () => runAdapted(adapted.queryFn),
        ...(adapted.staleTime !== undefined
          ? { staleTime: adapted.staleTime }
          : {}),
        retry: retryAdaptedRead,
      });
      return;
    }
  }
  // No row, no prefetch: a loader must never be the thing that discovers a
  // missing registry key, so this stays silent (the component's own read
  // raises the named error).
  console.warn(`[prefetch] no 0.5 row for ${name} — skipping prefetch`);
}

/**
 * The awaiting twin of {@link prefetchAdaptedQuery} — for a loader that
 * needs the VALUE (a document title, a redirect decision), not just a warm
 * cache. Same lane choice, same key.
 */
export async function ensureAdaptedQueryData<Name extends QueryName>(
  queryClient: QueryClient,
  name: Name,
  args: ArgsOf<Name>,
): Promise<ReturnsOf<Name>> {
  const adapter = READ_ADAPTERS[name];
  if (adapter !== undefined) {
    const orgId = activeOrganizationId();
    const adapted = adapter(
      args,
      orgId !== undefined ? { organizationId: orgId } : {},
    );
    if (adapted !== null) {
      // The row projects to this name's contract return shape by
      // construction — through its `select` when the cached body is shared.
      const data = await queryClient.ensureQueryData<unknown>({
        queryKey: adapted.queryKey,
        queryFn: () => runAdapted(adapted.queryFn),
        ...(adapted.staleTime !== undefined
          ? { staleTime: adapted.staleTime }
          : {}),
        retry: retryAdaptedRead,
      });
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the row and this name's contract entry are keyed alike, so the row's projection IS this return shape
      return projectAdaptedRead(adapted, data) as ReturnsOf<Name>;
    }
  }
  // A loader that NEEDS the value cannot degrade quietly.
  throw new MissingBackendRowError(name);
}

/**
 * The infinite-query options of an adapted paginated read. The listing hook
 * (`useCachedPaginatedQuery`) and {@link prefetchAdaptedPaginatedQuery} build
 * the same ones, so a prefetched first page is the page the listing reads.
 */
export function adaptedInfiniteQueryOptions(
  opts: AdaptedPaginatedOptions,
  numItems: number,
) {
  return {
    queryKey: opts.queryKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: unknown }) =>
      runAdapted(() =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- react-query types pageParam as unknown; this lane only ever stores string|null cursors
        opts.fetchPage(pageParam as string | null, numItems),
      ),
    getNextPageParam: (last: AdaptedPage) =>
      last.isDone ? undefined : last.continueCursor,
    retry: retryAdaptedRead,
  };
}

/**
 * The first page of a paginated listing, into the cache under the key its
 * `useCachedPaginatedQuery` reads — for a surface that knows a listing is
 * coming before the component that reads it has mounted.
 */
export function prefetchAdaptedPaginatedQuery<Name extends PaginatedName>(
  queryClient: QueryClient,
  name: Name,
  args: Omit<ArgsOf<Name>, 'paginationOpts'>,
  numItems: number,
): void {
  const adapter = PAGINATED_ADAPTERS[name];
  if (adapter === undefined) {
    console.warn(`[prefetch] no 0.5 row for ${name} — skipping prefetch`);
    return;
  }
  const orgId = activeOrganizationId();
  const opts = adapter(
    args,
    orgId !== undefined ? { organizationId: orgId } : {},
  );
  if (opts === null) return;
  void queryClient.prefetchInfiniteQuery(
    adaptedInfiniteQueryOptions(opts, numItems),
  );
}
