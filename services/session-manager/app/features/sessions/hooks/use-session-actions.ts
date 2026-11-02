import { toast } from '@tale/ui/use-toast';
import { useQueryClient } from '@tanstack/react-query';

import { useApiMutation } from '@/app/hooks/use-api-mutation';
import { sessionsApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';
import { downloadJson } from '@/app/lib/download';
import type { SessionCreate } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { REMOVE_SESSION_KEY } from '../lib/removal';

// A write to a session changes what the lists show: the sessions, the counts
// of the app, and the proxies (a proxy is given to a session, or freed). It
// also changes the sessions a secret can be for (a new one, a new name).
const AFFECTS = [
  queryKeys.sessions,
  queryKeys.meta,
  queryKeys.proxies,
  queryKeys.sessionChoices,
];

/** The file the proxies of the sessions are downloaded as. */
const PROXY_EXPORT_FILENAME = 'proxy.json';

/**
 * Everything a person does to a session. A failure raises one toast, except
 * the refusals a dialog words itself (`quietFor`): `ProxyFlowProvider` reads
 * those from the answer and asks the person (see `createProxyFlows`).
 */
export function useSessionActions() {
  const { t } = useT('sessions');
  const queryClient = useQueryClient();

  const create = useApiMutation({
    mutationFn: (input: Partial<SessionCreate>) => sessionsApi.create(input),
    errorTitle: t('toasts.createFailed'),
    // The add dialog shows the names beside its field; no free proxy opens the
    // dialog that adds some.
    quietFor: ['name_taken', 'invalid_name', 'no_free_proxy'],
    invalidates: AFFECTS,
  });

  const rename = useApiMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      sessionsApi.rename(id, name),
    errorTitle: t('toasts.renameFailed'),
    quietFor: ['name_taken', 'invalid_name'],
    invalidates: AFFECTS,
  });

  const start = useApiMutation({
    mutationFn: ({ id, force }: { id: number; force?: boolean }) =>
      sessionsApi.start(id, force),
    errorTitle: t('toasts.startFailed'),
    // Each of these is a question: start anyway? add proxies? give the broken
    // proxy up for another one?
    quietFor: ['ip_in_use', 'no_free_proxy', 'proxy_unreachable'],
    invalidates: AFFECTS,
  });

  const stop = useApiMutation({
    mutationFn: ({ id }: { id: number }) => sessionsApi.stop(id),
    errorTitle: t('toasts.stopFailed'),
    invalidates: AFFECTS,
  });

  const restart = useApiMutation({
    mutationFn: ({ id }: { id: number }) => sessionsApi.restart(id),
    errorTitle: t('toasts.restartFailed'),
    invalidates: AFFECTS,
  });

  const rotate = useApiMutation({
    mutationFn: ({ id }: { id: number }) => sessionsApi.rotate(id),
    errorTitle: t('toasts.rotateFailed'),
    quietFor: ['no_free_proxy'],
    invalidates: AFFECTS,
  });

  const checkIp = useApiMutation({
    mutationFn: ({ id }: { id: number }) => sessionsApi.checkIp(id),
    errorTitle: t('toasts.checkIpFailed'),
    invalidates: AFFECTS,
  });

  const remove = useApiMutation({
    // Named, so that whatever reads the session can tell it is going away
    // and not ask for it (see `removalOf`).
    mutationKey: REMOVE_SESSION_KEY,
    mutationFn: ({ id }: { id: number }) => sessionsApi.remove(id),
    errorTitle: t('toasts.deleteFailed'),
    // The session itself is forgotten rather than read again, which the
    // backend could only answer with a 404; the lists are read afresh, and
    // a session's own secrets go with it.
    invalidates: [
      queryKeys.sessionLists,
      queryKeys.meta,
      queryKeys.proxies,
      queryKeys.secrets,
      queryKeys.sessionChoices,
    ],
    onSuccess: (_removed, { id }) => {
      queryClient.removeQueries({ queryKey: queryKeys.session(id) });
    },
  });

  const exportProxies = useApiMutation({
    // The file holds the proxies' passwords, and a mutation keeps what it
    // answered in the mutation cache: the download is part of the write, and
    // the write answers with nothing.
    mutationFn: async () => {
      downloadJson(PROXY_EXPORT_FILENAME, await sessionsApi.exportProxies());
    },
    errorTitle: t('toasts.exportFailed'),
    gcTime: 0,
    onSuccess: () => {
      toast({
        variant: 'success',
        title: t('notices.exported', { filename: PROXY_EXPORT_FILENAME }),
      });
    },
  });

  return {
    create,
    rename,
    start,
    stop,
    restart,
    rotate,
    checkIp,
    remove,
    exportProxies,
  };
}
