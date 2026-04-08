import { useQuery } from '@tanstack/react-query';
import { useAction, useConvexAuth } from 'convex/react';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';

interface ActionQueryOptions {
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
}

export function useActionQuery<Func extends FunctionReference<'action'>>(
  queryKey: readonly unknown[],
  func: Func,
  args: FunctionArgs<Func>,
  options?: ActionQueryOptions,
) {
  const action = useAction(func);
  const { isAuthenticated } = useConvexAuth();
  // oxlint-disable-next-line typescript/no-unnecessary-type-arguments -- required: removing loses return-type inference for callers
  return useQuery<FunctionReturnType<Func>>({
    queryKey,
    queryFn: () => action(args),
    staleTime: Infinity,
    ...options,
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
}
