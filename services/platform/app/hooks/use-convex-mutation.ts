import { useConvexMutation as useMutationFn } from '@convex-dev/react-query';
import type { UseMutationOptions } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OptimisticUpdate } from 'convex/browser';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';
import { getFunctionName } from 'convex/server';

import { toast } from '@/app/hooks/use-toast';
import {
  activeOrganizationId,
  runAdapted,
  WRITE_ADAPTERS,
} from '@/app/lib/backend/convex-adapters';
import { useT } from '@/lib/i18n/client';
import { convexUserMessage } from '@/lib/utils/convex-error';

interface ConvexMutationExtras<Func extends FunctionReference<'mutation'>> {
  /**
   * Convex-native optimistic patch. Applied to the live query store the instant
   * the mutation fires and rolled back automatically when it settles (success
   * or error) — compose with the helpers in `optimistic-updates.ts`. Only use
   * when the optimistic value is a straightforward projection of the args.
   * Writes served by the 0.5 backend adapter ignore it — there is no Convex
   * query store on that lane; invalidation refetches instead.
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
  const {
    optimisticUpdate,
    errorToast,
    onError,
    onSuccess,
    ...mutationOptions
  } = options ?? {};
  const { t } = useT('toast');
  const queryClient = useQueryClient();

  // A family migrated to the 0.5 backend runs this write over HTTP; the
  // Convex mutation stays wired for everything else (same hook order).
  const adapter = WRITE_ADAPTERS[getFunctionName(func)];
  const organizationId =
    adapter === undefined ? undefined : activeOrganizationId();
  const adapterCtx = organizationId !== undefined ? { organizationId } : {};
  const mutate = useMutationFn(func);
  const convexFn = optimisticUpdate
    ? mutate.withOptimisticUpdate(optimisticUpdate)
    : mutate;
  const mutationFn = (
    args: FunctionArgs<Func>,
  ): Promise<FunctionReturnType<Func>> =>
    adapter !== undefined
      ? runAdapted(() => adapter.run(args, adapterCtx))
      : convexFn(args);

  return useMutation({
    mutationFn,
    onSuccess: (...successArgs) => {
      if (adapter?.invalidate !== undefined) {
        adapter.invalidate(queryClient, successArgs[1], adapterCtx);
      }
      return onSuccess?.(...successArgs);
    },
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
