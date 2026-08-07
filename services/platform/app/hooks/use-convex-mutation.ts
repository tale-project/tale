import { useConvexMutation as useMutationFn } from '@convex-dev/react-query';
import type { UseMutationOptions } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import type { OptimisticUpdate } from 'convex/browser';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';
import { getFunctionName } from 'convex/server';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { convexUserMessage } from '@/lib/utils/convex-error';

interface ConvexMutationExtras<Func extends FunctionReference<'mutation'>> {
  /**
   * Convex-native optimistic patch. Applied to the live query store the instant
   * the mutation fires and rolled back automatically when it settles (success
   * or error) — compose with the helpers in `optimistic-updates.ts`. Only use
   * when the optimistic value is a straightforward projection of the args.
   */
  optimisticUpdate?: OptimisticUpdate<FunctionArgs<Func>>;
  /**
   * Error feedback on failure. Defaults to a destructive toast with a generic
   * message so a failed mutation never silently lingers. Pass `false` to opt out
   * (e.g. when the caller already toasts), or an object to override the copy.
   */
  errorToast?:
    | { title: string; description?: (error: Error) => string | undefined }
    | false;
}

type ConvexMutationOptions<Func extends FunctionReference<'mutation'>> = Omit<
  // oxlint-disable-next-line typescript/no-unnecessary-type-arguments -- FunctionArgs<Func> is not the default (void)
  UseMutationOptions<FunctionReturnType<Func>, Error, FunctionArgs<Func>>,
  'mutationFn'
> &
  ConvexMutationExtras<Func>;

export function useConvexMutation<Func extends FunctionReference<'mutation'>>(
  func: Func,
  options?: ConvexMutationOptions<Func>,
) {
  const { optimisticUpdate, errorToast, onError, ...mutationOptions } =
    options ?? {};
  const { t } = useT('toast');

  const mutate = useMutationFn(func);
  const mutationFn = optimisticUpdate
    ? mutate.withOptimisticUpdate(optimisticUpdate)
    : mutate;

  return useMutation({
    mutationFn: (args: FunctionArgs<Func>) => mutationFn(args),
    onError: (error, ...rest) => {
      // Never swallow a mutation failure, even when the visible toast is opted out.
      console.error(`Mutation failed: ${getFunctionName(func)}`, error);
      if (errorToast !== false) {
        toast({
          title: errorToast?.title ?? t('error.generic.title'),
          description:
            errorToast?.description?.(error) ??
            convexUserMessage(error, t('error.generic.description')),
          variant: 'destructive',
        });
      }
      onError?.(error, ...rest);
    },
    ...mutationOptions,
  });
}
