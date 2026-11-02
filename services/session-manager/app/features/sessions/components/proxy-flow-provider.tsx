import { useToast } from '@tale/ui/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { failureText } from '@/app/lib/api/failure';
import { useT } from '@/lib/i18n/client';

import { useBusySessions } from '../hooks/use-busy-sessions';
import { useDialogQueue } from '../hooks/use-dialog-queue';
import { ProxyFlowContext, type ProxyFlow } from '../hooks/use-proxy-flow';
import { useSessionActions } from '../hooks/use-session-actions';
import { FollowedSessions } from '../lib/followed-sessions';
import {
  createProxyFlows,
  type BrokenProxyChoice,
  type SharedIpChoice,
} from '../lib/proxy-flows';
import { settle } from '../lib/settle';
import { BrokenProxyDialog } from './broken-proxy-dialog';
import { NoFreeProxyDialog } from './no-free-proxy-dialog';
import { NoWorkingProxyDialog } from './no-working-proxy-dialog';
import { SharedIpDialog } from './shared-ip-dialog';

/**
 * Mounted once, at the root of the app, so that what a person started goes on
 * when they leave the page they started it on: the dialogs it needs, the
 * request that is made again once proxies were added, the session that is
 * looked at until its work is over. `useProxyFlow` is how a control reaches it.
 */
export function ProxyFlowProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useT('sessions');
  const { t: tErrors } = useT('errors');
  // The requests are the mutations' own, which stay the same for as long as
  // the provider lives.
  const {
    start: { mutateAsync: requestStart },
    rotate: { mutateAsync: requestRotation },
    create: { mutateAsync: requestCreation },
  } = useSessionActions();
  const { show, current: dialog } = useDialogQueue();
  const { track, isBusy } = useBusySessions();
  const [following] = useState(() => new FollowedSessions(queryClient));

  const flows = useMemo(
    () =>
      createProxyFlows({
        start: (id, force) => settle(requestStart({ id, force })),
        rotate: (id) => settle(requestRotation({ id })),
        create: (input) => settle(requestCreation(input)),
        askForProxies: (action, returnFocusTo) =>
          show<boolean>((answer) => (
            <NoFreeProxyDialog
              action={action}
              returnFocusTo={returnFocusTo}
              onAnswer={answer}
            />
          )),
        askForWorkingProxies: (sessions) =>
          show<boolean>((answer) => (
            <NoWorkingProxyDialog sessions={sessions} onAnswer={answer} />
          )),
        askAboutSharedIp: (session, conflict) =>
          show<SharedIpChoice>((answer) => (
            <SharedIpDialog
              sessionName={session.name}
              conflict={conflict}
              onAnswer={answer}
            />
          )),
        askAboutBrokenProxy: (session, error) =>
          show<BrokenProxyChoice>((answer) => (
            <BrokenProxyDialog
              sessionName={session.name}
              error={error}
              onAnswer={answer}
            />
          )),
        follow: following.follow,
        open: (sessionId) => {
          void navigate({
            to: '/sessions/$sessionId',
            params: { sessionId: String(sessionId) },
          });
        },
        track,
        tell: (action, error) => {
          const titles = {
            create: t('toasts.createFailed'),
            start: t('toasts.startFailed'),
            rotate: t('toasts.rotateFailed'),
          };
          toast({
            variant: 'destructive',
            title: titles[action],
            description: failureText(error, tErrors),
          });
        },
      }),
    [
      requestStart,
      requestRotation,
      requestCreation,
      show,
      following,
      navigate,
      track,
      toast,
      t,
      tErrors,
    ],
  );

  const { finished } = flows;
  useEffect(
    () =>
      following.listen((over) => {
        finished(over).catch((error: unknown) => {
          console.error(
            'the work a session was followed for could not go on',
            error,
          );
        });
      }),
    [following, finished],
  );
  // The work is the app's, not a page's: it is looked at until the app ends.
  useEffect(() => following.dispose, [following]);

  const { start, rotate, create, addProxiesFor } = flows;
  const value = useMemo<ProxyFlow>(
    () => ({
      start,
      rotate,
      create,
      addProxiesFor,
      isStarting: (sessionId) => isBusy('start', sessionId),
      isRotating: (sessionId) => isBusy('rotate', sessionId),
    }),
    [start, rotate, create, addProxiesFor, isBusy],
  );

  return (
    <ProxyFlowContext.Provider value={value}>
      {children}
      {dialog}
    </ProxyFlowContext.Provider>
  );
}
