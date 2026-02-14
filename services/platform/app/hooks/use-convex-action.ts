import type { UseMutationOptions } from '@tanstack/react-query';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';

import { useConvexAction as useActionFn } from '@convex-dev/react-query';
import { useMutation } from '@tanstack/react-query';

export function useConvexAction<Func extends FunctionReference<'action'>>(
  func: Func,
  options?: Omit<
    UseMutationOptions<FunctionReturnType<Func>, Error, FunctionArgs<Func>>,
    'mutationFn'
  >,
) {
  const action = useActionFn(func);
  return useMutation({
    mutationFn: (args: FunctionArgs<Func>) => action(args),
    ...options,
  });
}
