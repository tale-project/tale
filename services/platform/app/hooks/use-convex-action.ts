import { useConvexAction as useActionFn } from '@convex-dev/react-query';
import type { UseMutationOptions } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';

export function useConvexAction<Func extends FunctionReference<'action'>>(
  func: Func,
  options?: Omit<
    // oxlint-disable-next-line typescript/no-unnecessary-type-arguments -- required: removing loses type inference for callers
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
