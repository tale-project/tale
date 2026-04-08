import { useConvexAction as useActionFn } from '@convex-dev/react-query';
import type { UseMutationOptions } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import type { FunctionArgs, FunctionReference } from 'convex/server';

export function useConvexAction<Func extends FunctionReference<'action'>>(
  func: Func,
  options?: Omit<UseMutationOptions, 'mutationFn'>,
) {
  const action = useActionFn(func);
  return useMutation({
    mutationFn: (args: FunctionArgs<Func>) => action(args),
    ...options,
  });
}
