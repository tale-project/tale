import type { UseMutationOptions } from '@tanstack/react-query';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';

import { useMutation } from '@tanstack/react-query';

import { invalidateConvexQueries } from './invalidate';
import { useConvexClient } from './use-convex-client';
import { useReactQueryClient } from './use-react-query-client';

export function useConvexAction<Func extends FunctionReference<'action'>>(
  func: Func,
  options?: Omit<
    UseMutationOptions<FunctionReturnType<Func>, Error, FunctionArgs<Func>>,
    'mutationFn'
  > & {
    invalidates?: FunctionReference<'query'>[];
  },
) {
  const { invalidates, ...mutationOptions } = options ?? {};
  const convexClient = useConvexClient();
  const queryClient = useReactQueryClient();

  return useMutation({
    mutationFn: (args: FunctionArgs<Func>) => convexClient.action(func, args),
    ...mutationOptions,
    onSettled: async (...args) => {
      if (invalidates?.length) {
        await invalidateConvexQueries(queryClient, invalidates);
      }
      return mutationOptions.onSettled?.(...args);
    },
  });
}
