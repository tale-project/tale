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
import { ConvexRetiredError } from '@/app/lib/backend/retired-convex';
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

  // Every shipped write runs over HTTP through its adapter row; a ref
  // without one has no server left to reach (see `retired-convex.ts`).
  const fnName = getFunctionName(func);
  const adapter = WRITE_ADAPTERS[fnName];
  const organizationId =
    adapter === undefined ? undefined : activeOrganizationId();
  const adapterCtx = organizationId !== undefined ? { organizationId } : {};
  // The optimistic-update callback belonged to the Convex mutation's local
  // store; the adapted lane invalidates instead (its `invalidate` hook), so
  // it is accepted and unused rather than silently changing behaviour.
  void optimisticUpdate;
  const mutationFn = (
    args: FunctionArgs<Func>,
  ): Promise<FunctionReturnType<Func>> =>
    adapter !== undefined
      ? runAdapted(() => adapter.run(args, adapterCtx))
      : Promise.reject(new ConvexRetiredError(fnName));

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
