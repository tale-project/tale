import type { QueryClient } from '@tanstack/react-query';
import type { FunctionReference } from 'convex/server';

import { convexQuery } from '@convex-dev/react-query';

export function invalidateConvexQueries(
  queryClient: QueryClient,
  funcs: FunctionReference<'query'>[],
) {
  return Promise.all(
    funcs.map((func) =>
      queryClient.invalidateQueries({
        queryKey: convexQuery(func, {}).queryKey.slice(0, 2),
      }),
    ),
  );
}
