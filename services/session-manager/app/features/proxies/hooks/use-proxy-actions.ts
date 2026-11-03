import { useToast } from '@tale/ui/use-toast';

import { useApiMutation } from '@/app/hooks/use-api-mutation';
import { proxiesApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';
import type { Scheme } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

// A write to the pool changes the table and the counts of the app.
const AFFECTS_POOL = [queryKeys.proxies, queryKeys.meta];

// A proxy is typed with its password, and the mutation cache keeps what a
// write was called with: it lets go of the ones that carry the text as soon as
// the dialog that made them is gone, not minutes later.
const FORGET = 0;

/**
 * Adds one proxy; it is checked in the background. The refusals the dialog
 * words beside its field (unreadable, already in the pool) raise no toast.
 */
export function useAddProxy() {
  const { t } = useT('proxies');
  const { toast } = useToast();
  return useApiMutation({
    mutationFn: ({ proxy, scheme }: { proxy: string; scheme: Scheme }) =>
      proxiesApi.add(proxy, scheme),
    errorTitle: t('toasts.addFailed'),
    quietFor: ['invalid_proxy', 'duplicate', 'validation_error'],
    invalidates: AFFECTS_POOL,
    gcTime: FORGET,
    onSuccess: () => {
      toast({
        title: t('toasts.added'),
        description: t('toasts.addedDetail'),
        variant: 'success',
      });
    },
  });
}

/** Imports a list; the dialog shows the report, so no notice of its own. */
export function useImportProxies() {
  const { t } = useT('proxies');
  return useApiMutation({
    mutationFn: ({ text, scheme }: { text: string; scheme: Scheme }) =>
      proxiesApi.import(text, scheme),
    errorTitle: t('toasts.importFailed'),
    invalidates: AFFECTS_POOL,
    gcTime: FORGET,
  });
}

/** Starts a check of one proxy; the row shows "Checking" until the poll sees the result. */
export function useCheckProxy() {
  const { t } = useT('proxies');
  const { toast } = useToast();
  return useApiMutation({
    mutationFn: ({ id }: { id: number }) => proxiesApi.check(id),
    errorTitle: t('toasts.checkFailed'),
    invalidates: AFFECTS_POOL,
    onSuccess: () => {
      toast({ title: t('toasts.checking') });
    },
  });
}

/** Starts a check of every proxy. */
export function useCheckAllProxies() {
  const { t } = useT('proxies');
  const { toast } = useToast();
  return useApiMutation({
    mutationFn: () => proxiesApi.checkAll(),
    errorTitle: t('toasts.checkAllFailed'),
    invalidates: AFFECTS_POOL,
    onSuccess: () => {
      toast({ title: t('toasts.checkingAll') });
    },
  });
}

/**
 * Deletes a proxy. A proxy a stopped session has is refused (`proxy_in_use`)
 * until the person agrees (`force`), one a running session has (`proxy_busy`)
 * always: the dialog words both, so neither raises a toast. The session that
 * had it gets another proxy, hence the sessions are stale too.
 */
export function useDeleteProxy() {
  const { t } = useT('proxies');
  const { toast } = useToast();
  return useApiMutation({
    mutationFn: ({ id, force }: { id: number; force: boolean }) =>
      proxiesApi.remove(id, force),
    errorTitle: t('toasts.deleteFailed'),
    quietFor: ['proxy_in_use', 'proxy_busy'],
    invalidates: [...AFFECTS_POOL, queryKeys.sessions],
    onSuccess: () => {
      toast({ title: t('toasts.deleted'), variant: 'success' });
    },
  });
}
