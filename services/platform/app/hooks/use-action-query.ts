import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';

import { useQuery } from '@tanstack/react-query';
import { useAction } from 'convex/react';

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
  return useQuery<FunctionReturnType<Func>>({
    queryKey,
    queryFn: () => action(args),
    staleTime: Infinity,
    ...options,
  });
}
