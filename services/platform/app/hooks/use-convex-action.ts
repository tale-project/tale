import type { UseMutationOptions } from '@tanstack/react-query';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';

import { useMutation } from '@tanstack/react-query';

import { useConvexClient } from './use-convex-client';

export function useConvexAction<Func extends FunctionReference<'action'>>(
  func: Func,
  options?: Omit<
    UseMutationOptions<FunctionReturnType<Func>, Error, FunctionArgs<Func>>,
    'mutationFn'
  >,
) {
  const convexClient = useConvexClient();

  return useMutation({
    mutationFn: (args: FunctionArgs<Func>) => convexClient.action(func, args),
    ...options,
  });
}
