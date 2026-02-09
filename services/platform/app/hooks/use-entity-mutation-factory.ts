import type { FunctionReference, OptionalRestArgs } from 'convex/server';

import { useMutation } from 'convex/react';

// oxlint-disable-next-line typescript/no-explicit-any -- Convex generic mutation type requires any for flexible arg/return types
type MutationFunction = FunctionReference<'mutation', 'public', any, any>;
type QueryFunction = FunctionReference<
  'query',
  'public',
  { organizationId: string },
  // oxlint-disable-next-line typescript/no-explicit-any -- Convex FunctionReference requires any[] for generic query patterns
  any[]
>;

interface UpdateMutationConfig<
  TMutation extends MutationFunction,
  TQuery extends QueryFunction,
  TItem,
> {
  mutationFn: TMutation;
  getAllQuery: TQuery;
  getId: (args: OptionalRestArgs<TMutation>[0]) => string;
  getItemId: (item: TItem) => string;
  applyUpdate: (item: TItem, args: OptionalRestArgs<TMutation>[0]) => TItem;
}

interface DeleteMutationConfig<
  TMutation extends MutationFunction,
  TQuery extends QueryFunction,
  TItem,
> {
  mutationFn: TMutation;
  getAllQuery: TQuery;
  getId: (args: OptionalRestArgs<TMutation>[0]) => string;
  getItemId: (item: TItem) => string;
}

interface CreateMutationConfig<
  TMutation extends MutationFunction,
  TQuery extends QueryFunction,
  TItem,
> {
  mutationFn: TMutation;
  getAllQuery: TQuery;
  createOptimisticItem: (args: OptionalRestArgs<TMutation>[0]) => TItem;
}

export function createUpdateMutation<
  TMutation extends MutationFunction,
  TQuery extends QueryFunction,
  TItem,
>(config: UpdateMutationConfig<TMutation, TQuery, TItem>) {
  return function useUpdateMutation(organizationId: string) {
    return useMutation(config.mutationFn).withOptimisticUpdate(
      (localStore, args) => {
        // oxlint-disable-next-line typescript/no-explicit-any -- Convex localStore.getQuery requires exact FunctionReference; generic type not assignable
        const current = localStore.getQuery(config.getAllQuery as any, {
          organizationId,
        });

        if (current !== undefined) {
          const targetId = config.getId(args);
          const updated = (current as TItem[]).map((item) =>
            config.getItemId(item) === targetId
              ? config.applyUpdate(item, args)
              : item,
          );

          localStore.setQuery(
            // oxlint-disable-next-line typescript/no-explicit-any -- Convex localStore.setQuery requires exact FunctionReference; generic type not assignable
            config.getAllQuery as any,
            { organizationId },
            updated,
          );
        }
      },
    );
  };
}

export function createDeleteMutation<
  TMutation extends MutationFunction,
  TQuery extends QueryFunction,
  TItem,
>(config: DeleteMutationConfig<TMutation, TQuery, TItem>) {
  return function useDeleteMutation(organizationId: string) {
    return useMutation(config.mutationFn).withOptimisticUpdate(
      (localStore, args) => {
        // oxlint-disable-next-line typescript/no-explicit-any -- Convex localStore.getQuery requires exact FunctionReference; generic type not assignable
        const current = localStore.getQuery(config.getAllQuery as any, {
          organizationId,
        });

        if (current !== undefined) {
          const targetId = config.getId(args);
          const updated = (current as TItem[]).filter(
            (item) => config.getItemId(item) !== targetId,
          );

          localStore.setQuery(
            // oxlint-disable-next-line typescript/no-explicit-any -- Convex localStore.setQuery requires exact FunctionReference; generic type not assignable
            config.getAllQuery as any,
            { organizationId },
            updated,
          );
        }
      },
    );
  };
}

export function createCreateMutation<
  TMutation extends MutationFunction,
  TQuery extends QueryFunction,
  TItem,
>(config: CreateMutationConfig<TMutation, TQuery, TItem>) {
  return function useCreateMutation(organizationId: string) {
    return useMutation(config.mutationFn).withOptimisticUpdate(
      (localStore, args) => {
        // oxlint-disable-next-line typescript/no-explicit-any -- Convex localStore.getQuery requires exact FunctionReference; generic type not assignable
        const current = localStore.getQuery(config.getAllQuery as any, {
          organizationId,
        });

        if (current !== undefined) {
          const optimisticItem = config.createOptimisticItem(args);
          const updated = [...(current as TItem[]), optimisticItem];

          localStore.setQuery(
            // oxlint-disable-next-line typescript/no-explicit-any -- Convex localStore.setQuery requires exact FunctionReference; generic type not assignable
            config.getAllQuery as any,
            { organizationId },
            updated,
          );
        }
      },
    );
  };
}
