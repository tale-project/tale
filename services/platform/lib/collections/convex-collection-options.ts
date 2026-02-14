import type {
  DeleteMutationFnParams,
  InsertMutationFnParams,
  UpdateMutationFnParams,
} from '@tanstack/db';
import type { QueryClient, QueryFunction } from '@tanstack/react-query';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';

import { convexQuery } from '@convex-dev/react-query';
import { queryCollectionOptions } from '@tanstack/query-db-collection';
import { createCollection } from '@tanstack/react-db';

type ConvexQueryRef = FunctionReference<'query'>;

type ConvexItemOf<TQuery extends ConvexQueryRef> =
  FunctionReturnType<TQuery> extends Array<infer TItem extends object>
    ? TItem
    : never;

interface ConvexCollectionConfig<
  TQuery extends ConvexQueryRef,
  TItem extends ConvexItemOf<TQuery>,
> {
  id: string;
  queryFn: TQuery;
  args: FunctionArgs<TQuery>;
  queryClient: QueryClient;
  convexQueryFn: QueryFunction;
  getKey: (item: TItem) => string;
  onInsert?: (params: InsertMutationFnParams<TItem>) => Promise<unknown>;
  onUpdate?: (params: UpdateMutationFnParams<TItem>) => Promise<unknown>;
  onDelete?: (params: DeleteMutationFnParams<TItem>) => Promise<unknown>;
}

function wrapHandler<TParams>(handler: (params: TParams) => Promise<unknown>) {
  return async (params: TParams) => {
    await handler(params);
    // Convex WebSocket subscription pushes updates automatically
    // via ConvexQueryClient → TanStack Query cache → QueryObserver,
    // so we skip the automatic refetch after mutation handlers.
    return { refetch: false };
  };
}

/**
 * Creates collection options for a Convex query, bridging Convex's real-time
 * WebSocket subscriptions into TanStack DB's QueryCollection.
 *
 * Data flow:
 *   Convex WebSocket → ConvexQueryClient → TanStack Query cache
 *     → QueryCollection QueryObserver → Collection sync store → Live Queries → UI
 *
 * Mutation flow:
 *   UI → convexClient.mutation() → Convex backend → WebSocket update → Collection syncs automatically
 */
export function convexCollectionOptions<
  TQuery extends ConvexQueryRef,
  TItem extends ConvexItemOf<TQuery> = ConvexItemOf<TQuery>,
>(
  config: ConvexCollectionConfig<TQuery, TItem>,
): Parameters<typeof createCollection<TItem, string>>[0] {
  const convexOpts = convexQuery(config.queryFn, config.args);

  const options = queryCollectionOptions<TItem, string>({
    id: config.id,
    queryKey: convexOpts.queryKey,
    // ConvexQueryClient's default queryFn sets up WebSocket subscriptions for
    // queries with "convexQuery" key prefix and returns TItem[] at runtime.
    // It's typed as returning `unknown` since it serves all query types on the
    // shared QueryClient, while queryCollectionOptions expects `Promise<TItem[]>`.
    queryFn: async (ctx) => {
      const data = await config.convexQueryFn(ctx);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexQueryClient queryFn returns TItem[] at runtime for convexQuery-prefixed keys
      return data as TItem[];
    },
    queryClient: config.queryClient,
    getKey: config.getKey,
    staleTime: Infinity,
    onInsert: config.onInsert ? wrapHandler(config.onInsert) : undefined,
    onUpdate: config.onUpdate ? wrapHandler(config.onUpdate) : undefined,
    onDelete: config.onDelete ? wrapHandler(config.onDelete) : undefined,
  });

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- @tanstack/query-db-collection resolves TKey to string|number and omits the SingleResult marker required by createCollection; both are third-party type gaps, safe since all Convex document IDs are strings
  return options as unknown as Parameters<
    typeof createCollection<TItem, string>
  >[0];
}

export type { ConvexCollectionConfig, ConvexItemOf };
