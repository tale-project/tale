import { useToast } from '@tale/ui/use-toast';
import {
  useMutation,
  useQueryClient,
  type MutationKey,
  type QueryKey,
} from '@tanstack/react-query';

import { ApiError } from '@/app/lib/api/client';
import { failureText } from '@/app/lib/api/failure';
import { useT } from '@/lib/i18n/client';

export interface ApiMutationOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  /**
   * The title of the toast a failed call raises; its text is the reason. One
   * failure, one toast: a failure is reported here, or by the caller (see
   * `quietFor`), never both.
   */
  errorTitle: string;
  /**
   * Codes of the backend's refusals the caller words itself (a dialog that asks
   * to go on anyway, an error beside the field). They raise no toast.
   */
  quietFor?: readonly string[];
  /**
   * What the write makes stale. A refused write counts too: the server can have
   * changed the thing anyway (a start that fails leaves its session in the
   * error state, which the row must show now, not at the next poll).
   */
  invalidates?: readonly QueryKey[];
  /** Names the write in the mutation cache, so that what reads the same thing can tell it is under way. */
  mutationKey?: MutationKey;
  /**
   * How long the mutation cache keeps the write after the last component that
   * watched it is gone (react-query's `gcTime`; five minutes unless said). The
   * cache holds what the write was called with and what it answered, so a
   * write that carries something that must not linger in memory (a secret's
   * values, a proxy's password) says 0.
   */
  gcTime?: number;
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
}

/**
 * A write to the backend: it refreshes what it changed, whether it worked or
 * not, and tells a failure once, in the person's language.
 */
export function useApiMutation<TData, TVariables = void>({
  mutationFn,
  errorTitle,
  quietFor = [],
  invalidates = [],
  mutationKey,
  gcTime,
  onSuccess,
}: ApiMutationOptions<TData, TVariables>) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useT('errors');

  return useMutation({
    ...(mutationKey === undefined ? {} : { mutationKey }),
    ...(gcTime === undefined ? {} : { gcTime }),
    mutationFn,
    onSuccess: async (data, variables) => {
      await onSuccess?.(data, variables);
    },
    onError: (error) => {
      if (error instanceof ApiError && quietFor.includes(error.code)) return;
      toast({
        variant: 'destructive',
        title: errorTitle,
        description: failureText(error, t),
      });
    },
    // Awaited: a caller that goes on once `mutateAsync` has settled finds the
    // lists current.
    onSettled: async () => {
      await Promise.all(
        invalidates.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}
