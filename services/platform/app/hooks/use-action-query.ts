import { useQuery } from '@tanstack/react-query';
import { useAction, useConvexAuth } from 'convex/react';
import type { FunctionArgs, FunctionReference } from 'convex/server';

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
  return useQuery({
    queryKey,
    queryFn: () => action(args),
    staleTime: Infinity,
    ...options,
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
}
