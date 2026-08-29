import { useConvexAction as useActionFn } from '@convex-dev/react-query';
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

  // A family migrated to the 0.5 backend runs this action over HTTP; the
  // Convex action stays wired for everything else (same hook order).
  const adapter = WRITE_ADAPTERS[getFunctionName(func)];
  const organizationId =
    adapter === undefined ? undefined : activeOrganizationId();
  const adapterCtx = organizationId !== undefined ? { organizationId } : {};
  const action = useActionFn(func);
  const mutationFn = (
    args: FunctionArgs<Func>,
  ): Promise<FunctionReturnType<Func>> =>
    adapter !== undefined
      ? runAdapted(() => adapter.run(args, adapterCtx))
      : action(args);

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
