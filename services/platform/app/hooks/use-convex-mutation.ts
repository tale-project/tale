import type { UseMutationOptions } from '@tanstack/react-query';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';

import { useConvexMutation as useMutationFn } from '@convex-dev/react-query';
import { useMutation } from '@tanstack/react-query';

export function useConvexMutation<Func extends FunctionReference<'mutation'>>(
  func: Func,
  options?: Omit<
    UseMutationOptions<FunctionReturnType<Func>, Error, FunctionArgs<Func>>,
    'mutationFn'
  >,
) {
  const mutate = useMutationFn(func);
  return useMutation({
    mutationFn: (args: FunctionArgs<Func>) => mutate(args),
    ...options,
  });
}
