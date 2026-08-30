import type { QueryClient } from '@tanstack/react-query';

import type { ArgsOf, QueryName, ReturnsOf } from './contract';
import {
  activeOrganizationId,
  READ_ADAPTERS,
  retryAdaptedRead,
  runAdapted,
} from './convex-adapters';
import { ConvexRetiredError } from './retired-convex';

/**
 * Route-loader prefetch that respects the adapter seam.
 *
 * A loader's job is to have the answer in the cache under the SAME key the
 * component will read, so the first paint has no skeleton flash — which means
 * going through the adapter row the component's own `useConvexQuery` will use,
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
      // The row projects to this name's contract return shape by construction.
      return await queryClient.ensureQueryData<ReturnsOf<Name>>({
        queryKey: adapted.queryKey,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the row and this name's contract entry are keyed alike, so the row's projection IS this return shape
        queryFn: () => runAdapted(adapted.queryFn) as Promise<ReturnsOf<Name>>,
        ...(adapted.staleTime !== undefined
          ? { staleTime: adapted.staleTime }
          : {}),
        retry: retryAdaptedRead,
      });
    }
  }
  // A loader that NEEDS the value cannot degrade quietly.
  throw new ConvexRetiredError(name);
}
