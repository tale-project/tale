import type {
  QueryClient,
  QueryKey,
  UseMutationOptions,
} from '@tanstack/react-query';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';

import { convexQuery } from '@convex-dev/react-query';
import { useMutation } from '@tanstack/react-query';

import { invalidateConvexQueries } from './invalidate';
import { useConvexClient } from './use-convex-client';
import { useOrganizationId } from './use-organization-id';
import { useReactQueryClient } from './use-react-query-client';

interface OptimisticContext {
  previous: unknown;
  queryKey: QueryKey;
}

function isOptimisticContext(value: unknown): value is OptimisticContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'previous' in value &&
    'queryKey' in value
  );
}

type CacheItem = Record<string, unknown> & { _id: string };

async function snapshot(
  queryClient: QueryClient,
  queryKey: QueryKey,
): Promise<OptimisticContext> {
  await queryClient.cancelQueries({ queryKey });
  return {
    previous: queryClient.getQueryData(queryKey),
    queryKey,
  };
}

let tempIdCounter = 0;

export interface InsertContext extends OptimisticContext {
  tempId: string;
}

export interface OptimisticHelpers {
  insert(
    this: void,
    item: Record<string, unknown>,
  ): Promise<InsertContext | undefined>;
  remove(this: void, id: string): Promise<OptimisticContext | undefined>;
  update(
    this: void,
    id: string,
    changes: Record<string, unknown>,
  ): Promise<OptimisticContext | undefined>;
  bulkUpdate(
    this: void,
    ids: string[],
    changes: Record<string, unknown>,
  ): Promise<OptimisticContext | undefined>;
  toggle(
    this: void,
    id: string,
    field: string,
  ): Promise<OptimisticContext | undefined>;
}

export function buildHelpers(
  queryClient: QueryClient,
  queryKey: QueryKey | undefined,
): OptimisticHelpers {
  return {
    async insert(item) {
      if (!queryKey) return undefined;
      const ctx = await snapshot(queryClient, queryKey);
      const tempId = `__optimistic_${Date.now()}_${tempIdCounter++}`;
      queryClient.setQueryData<CacheItem[]>(queryKey, (old) => [
        ...(old ?? []),
        { ...item, _id: tempId },
      ]);
      return { ...ctx, tempId };
    },
    async remove(id) {
      if (!queryKey) return undefined;
      const ctx = await snapshot(queryClient, queryKey);
      queryClient.setQueryData<CacheItem[]>(queryKey, (old) =>
        old?.filter((item) => item._id !== id),
      );
      return ctx;
    },
    async update(id, changes) {
      if (!queryKey) return undefined;
      const ctx = await snapshot(queryClient, queryKey);
      queryClient.setQueryData<CacheItem[]>(queryKey, (old) =>
        old?.map((item) => (item._id === id ? { ...item, ...changes } : item)),
      );
      return ctx;
    },
    async bulkUpdate(ids, changes) {
      if (!queryKey) return undefined;
      const idSet = new Set(ids);
      const ctx = await snapshot(queryClient, queryKey);
      queryClient.setQueryData<CacheItem[]>(queryKey, (old) =>
        old?.map((item) =>
          idSet.has(item._id) ? { ...item, ...changes } : item,
        ),
      );
      return ctx;
    },
    async toggle(id, field) {
      if (!queryKey) return undefined;
      const ctx = await snapshot(queryClient, queryKey);
      queryClient.setQueryData<CacheItem[]>(queryKey, (old) =>
        old?.map((item) =>
          item._id === id ? { ...item, [field]: !item[field] } : item,
        ),
      );
      return ctx;
    },
  };
}

interface OptimisticConfig<MFunc extends FunctionReference<'mutation'>> {
  queryArgs:
    | Record<string, unknown>
    | ((organizationId: string) => Record<string, unknown>)
    | undefined;
  onMutate: (
    args: FunctionArgs<MFunc>,
    helpers: OptimisticHelpers,
  ) => Promise<OptimisticContext | undefined>;
}

export function useConvexOptimisticMutation<
  MFunc extends FunctionReference<'mutation'>,
>(
  mutationFunc: MFunc,
  queryFunc: FunctionReference<'query'>,
  config: OptimisticConfig<MFunc>,
) {
  const convexClient = useConvexClient();
  const queryClient = useReactQueryClient();
  const organizationId = useOrganizationId();

  const resolvedArgs =
    typeof config.queryArgs === 'function'
      ? organizationId
        ? config.queryArgs(organizationId)
        : undefined
      : config.queryArgs;

  const queryKey = resolvedArgs
    ? convexQuery(queryFunc, resolvedArgs).queryKey
    : undefined;

  const helpers = buildHelpers(queryClient, queryKey);

  const options: UseMutationOptions<
    FunctionReturnType<MFunc>,
    Error,
    FunctionArgs<MFunc>
  > = {
    mutationFn: (args) => convexClient.mutation(mutationFunc, args),
    onMutate: (args) => config.onMutate(args, helpers),
    onError: (_err, _vars, onMutateResult) => {
      if (isOptimisticContext(onMutateResult)) {
        queryClient.setQueryData(
          onMutateResult.queryKey,
          onMutateResult.previous,
        );
      }
    },
    onSettled: async () => {
      await invalidateConvexQueries(queryClient, [queryFunc]);
    },
  };

  return useMutation(options);
}
