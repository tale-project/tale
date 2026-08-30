import type { UseMutationOptions } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';

/* oxlint-disable typescript/no-unsafe-type-assertion -- the adapter
   registry is the untyped boundary: a row and the contract entry it
   serves are keyed by the SAME name, so the row's projection IS that
   name's return shape. */
import { toast } from '@/app/hooks/use-toast';
import {
  activeOrganizationId,
  runAdapted,
  WRITE_ADAPTERS,
} from '@/app/lib/backend/adapters';
import type { ActionName, ArgsOf, ReturnsOf } from '@/app/lib/backend/contract';
import { MissingBackendRowError } from '@/app/lib/backend/missing-row';
import { useT } from '@/lib/i18n/client';
import { backendUserMessage } from '@/lib/utils/backend-error';

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

type ConvexActionOptions<Name extends ActionName> = Omit<
  UseMutationOptions<ReturnsOf<Name>, Error, ArgsOf<Name>>,
  'mutationFn'
> &
  ConvexActionExtras;

/**
 * A backend action, addressed by its contract name — the same write lane as
 * {@link useBackendMutation}, kept separate because the 0.4 split between
 * mutations and actions is what the adapter rows are keyed on.
 */
export function useBackendAction<Name extends ActionName>(
  name: Name,
  options?: ConvexActionOptions<Name>,
) {
  const { errorToast, onError, onSuccess, ...actionOptions } = options ?? {};
  const { t } = useT('toast');
  const queryClient = useQueryClient();

  // Every shipped action runs over HTTP through its adapter row; a name
  // without one has no server left to reach (see `missing-row.ts`).
  const adapter = WRITE_ADAPTERS[name];
  const organizationId =
    adapter === undefined ? undefined : activeOrganizationId();
  const adapterCtx = organizationId !== undefined ? { organizationId } : {};
  const mutationFn = (args: ArgsOf<Name>): Promise<ReturnsOf<Name>> =>
    adapter !== undefined
      ? (runAdapted(() =>
          adapter.run(args as Record<string, unknown>, adapterCtx),
        ) as Promise<ReturnsOf<Name>>)
      : Promise.reject(new MissingBackendRowError(name));

  return useMutation({
    mutationFn,
    onSuccess: (...successArgs) => {
      if (adapter?.invalidate !== undefined) {
        adapter.invalidate(queryClient, successArgs[1], adapterCtx);
      }
      return onSuccess?.(...successArgs);
    },
    onError: (error, ...rest) => {
      console.error(`Action failed: ${name}`, error);
      if (errorToast !== false) {
        toast({
          title: errorToast?.title ?? t('error.generic.title'),
          description:
            errorToast?.description?.(error) ??
            backendUserMessage(error, t('error.generic.description')),
          variant: 'destructive',
        });
      }
      onError?.(error, ...rest);
    },
    ...actionOptions,
  });
}
