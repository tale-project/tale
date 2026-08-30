import type { UseMutationOptions } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';

/* oxlint-disable typescript/no-unsafe-type-assertion -- the adapter
   registry is the untyped boundary: a row and the contract entry it
   serves are keyed by the SAME name, so the row's projection IS that
   name's return shape. */
import { toast } from '@/app/hooks/use-toast';
import type {
  ArgsOf,
  MutationName,
  ReturnsOf,
} from '@/app/lib/backend/contract';
import {
  activeOrganizationId,
  runAdapted,
  WRITE_ADAPTERS,
} from '@/app/lib/backend/convex-adapters';
import { ConvexRetiredError } from '@/app/lib/backend/retired-convex';
import { useT } from '@/lib/i18n/client';
import { convexUserMessage } from '@/lib/utils/convex-error';

interface ConvexMutationExtras {
  /**
   * Error feedback on failure. Defaults to a destructive toast with a generic
   * message so a failed mutation never silently lingers. Pass `false` to opt out
   * (e.g. when the caller already toasts), or an object to override the copy.
   */
  errorToast?:
    | { title: string; description?: (error: Error) => string | undefined }
    | false;
}

type ConvexMutationOptions<Name extends MutationName> = Omit<
  UseMutationOptions<ReturnsOf<Name>, Error, ArgsOf<Name>>,
  'mutationFn'
> &
  ConvexMutationExtras;

/**
 * A backend write, addressed by its contract name. The adapter row keyed by
 * that same name performs it over HTTP; a name with no row has no server left
 * to reach and rejects loudly (see `retired-convex.ts`).
 */
export function useConvexMutation<Name extends MutationName>(
  name: Name,
  options?: ConvexMutationOptions<Name>,
) {
  const { errorToast, onError, onSuccess, ...mutationOptions } = options ?? {};
  const { t } = useT('toast');
  const queryClient = useQueryClient();

  const adapter = WRITE_ADAPTERS[name];
  const organizationId =
    adapter === undefined ? undefined : activeOrganizationId();
  const adapterCtx = organizationId !== undefined ? { organizationId } : {};
  const mutationFn = (args: ArgsOf<Name>): Promise<ReturnsOf<Name>> =>
    adapter !== undefined
      ? (runAdapted(() =>
          adapter.run(args as Record<string, unknown>, adapterCtx),
        ) as Promise<ReturnsOf<Name>>)
      : Promise.reject(new ConvexRetiredError(name));

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
      console.error(`Mutation failed: ${name}`, error);
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
