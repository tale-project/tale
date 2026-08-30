import type { UseMutationOptions } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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

interface ConvexActionExtras {
  /**
   * Error feedback on failure. Defaults to a destructive toast with a generic
   * message so a failed action never silently lingers. Pass `false` to opt out
   * (e.g. when the caller already toasts), or an object to override the copy.
   */
  errorToast?:
    | { title: string; description?: (error: Error) => string | undefined }
    | false;
}

type ConvexActionOptions<Func extends FunctionReference<'action'>> = Omit<
  // oxlint-disable-next-line typescript/no-unnecessary-type-arguments -- FunctionArgs<Func> is not the default (void)
  UseMutationOptions<FunctionReturnType<Func>, Error, FunctionArgs<Func>>,
  'mutationFn'
> &
  ConvexActionExtras;

export function useConvexAction<Func extends FunctionReference<'action'>>(
  func: Func,
  options?: ConvexActionOptions<Func>,
) {
  const { errorToast, onError, onSuccess, ...actionOptions } = options ?? {};
  const { t } = useT('toast');
  const queryClient = useQueryClient();

  // Every shipped action runs over HTTP through its adapter row; a ref
  // without one has no server left to reach (see `retired-convex.ts`).
  const fnName = getFunctionName(func);
  const adapter = WRITE_ADAPTERS[fnName];
  const organizationId =
    adapter === undefined ? undefined : activeOrganizationId();
  const adapterCtx = organizationId !== undefined ? { organizationId } : {};
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
      console.error(`Action failed: ${getFunctionName(func)}`, error);
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
    ...actionOptions,
  });
}
