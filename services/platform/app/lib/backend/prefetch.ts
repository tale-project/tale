import { convexQuery } from '@convex-dev/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';
import { getFunctionName } from 'convex/server';

import {
  activeOrganizationId,
  READ_ADAPTERS,
  retryAdaptedRead,
  runAdapted,
} from './convex-adapters';

/**
 * Route-loader prefetch that respects the adapter seam.
 *
 * A loader's job is to have the answer in the cache under the SAME key the
 * component will read, so the first paint has no skeleton flash. Once a
 * family moves to the 0.5 backend the component reads through
 * `useConvexQuery`'s adapted lane — a `convexQuery` prefetch would then warm
 * the wrong key AND fire a doomed WebSocket query. This picks the lane the
 * component will actually use.
 */
export function prefetchAdaptedQuery<Func extends FunctionReference<'query'>>(
  queryClient: QueryClient,
  func: Func,
  args: FunctionArgs<Func>,
): void {
  const adapter = READ_ADAPTERS[getFunctionName(func)];
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
  void queryClient.prefetchQuery(convexQuery(func, args));
}

/**
 * The awaiting twin of {@link prefetchAdaptedQuery} — for a loader that
 * needs the VALUE (a document title, a redirect decision), not just a warm
 * cache. Same lane choice, same key.
 */
export async function ensureAdaptedQueryData<
  Func extends FunctionReference<'query'>,
>(
  queryClient: QueryClient,
  func: Func,
  args: FunctionArgs<Func>,
): Promise<FunctionReturnType<Func>> {
  const adapter = READ_ADAPTERS[getFunctionName(func)];
  if (adapter !== undefined) {
    const orgId = activeOrganizationId();
    const adapted = adapter(
      args,
      orgId !== undefined ? { organizationId: orgId } : {},
    );
    if (adapted !== null) {
      // The row projects to this query's 0.4 return shape by construction.
      return await queryClient.ensureQueryData<FunctionReturnType<Func>>({
        queryKey: adapted.queryKey,
        queryFn: () => runAdapted(adapted.queryFn),
        ...(adapted.staleTime !== undefined
          ? { staleTime: adapted.staleTime }
          : {}),
        retry: retryAdaptedRead,
      });
    }
  }
  return queryClient.ensureQueryData(convexQuery(func, args));
}
