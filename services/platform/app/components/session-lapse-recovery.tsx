import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { useT } from '@tale/ui/i18n/client';
import { Row } from '@tale/ui/layout';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { useSessionLapseRedirect } from '@/app/hooks/use-session-lapse-redirect';

type SessionLapseRecoveryState = ReturnType<typeof useSessionLapseRedirect>;

interface NoticeHost {
  recovery: SessionLapseRecoveryState;
  /** Show the standing notice in the caller's flow instead of floating it;
   * returns the release. */
  claim: () => () => void;
}

const NoticeHostContext = createContext<NoticeHost | null>(null);

/**
 * Keep the dashboard mounted until the person chooses to leave its drafts:
 * the confirmation, and after Stay here the standing notice that reopens it.
 * A layout with an alert stack shows that notice in its own flow
 * ({@link SessionLapseNotice}); a dashboard page without one gets it floating
 * at the top of the window.
 */
export function SessionLapseRecovery({
  recovery,
  children,
}: {
  recovery: SessionLapseRecoveryState;
  children?: ReactNode;
}) {
  const { t } = useT('auth');
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims((count) => count + 1);
    return () => setClaims((count) => count - 1);
  }, []);
  const host = useMemo(() => ({ recovery, claim }), [recovery, claim]);
  return (
    <NoticeHostContext.Provider value={host}>
      {children}
      {recovery.isLapsed && (
        <>
          {!recovery.open &&
            claims === 0 && (
              // `z-50`, the page's sticky headers' layer: rendered after the
              // page, the notice paints over them, and every dialog and sheet,
              // portaled to `<body>` after the app root, still paints over it.
              <div className="fixed inset-x-3 top-[calc(0.75rem+var(--safe-top))] z-50 mx-auto max-w-lg">
                <Alert
                  title={t('sessionLapse.title')}
                  description={t('sessionLapse.paused')}
                >
                  <Button
                    className="mt-3"
                    size="sm"
                    onClick={() => recovery.setOpen(true)}
                  >
                    {t('sessionLapse.signIn')}
                  </Button>
                </Alert>
              </div>
            )}
          <ConfirmDialog
            open={recovery.open}
            onOpenChange={recovery.setOpen}
            title={t('sessionLapse.title')}
            description={t('sessionLapse.description')}
            cancelText={t('sessionLapse.stayHere')}
            confirmText={t('sessionLapse.signIn')}
            disableConfirm={recovery.checking}
            onConfirm={recovery.continueToLogIn}
          >
            {recovery.checkFailed && (
              <Alert
                variant="destructive"
                description={t('sessionLapse.checkFailed')}
              />
            )}
          </ConfirmDialog>
        </>
      )}
    </NoticeHostContext.Provider>
  );
}

/**
 * The standing notice as a shell alert: in the flow above the page's header,
 * so the header's title, navigation and actions stay usable at every width,
 * which a notice floating over them was not on a phone. A narrow or short
 * viewport keeps it to its title and Sign in; the sentence stays for screen
 * readers. It pads the notch itself, since it sits above the header that
 * otherwise would.
 */
export function SessionLapseNotice() {
  const { t } = useT('auth');
  const host = useContext(NoticeHostContext);
  const claim = host?.claim;
  useLayoutEffect(() => claim?.(), [claim]);
  if (!host?.recovery.isLapsed || host.recovery.open) return null;
  const { recovery } = host;
  return (
    <Row
      role="status"
      gap={2}
      className="bg-warning/10 border-warning/30 shrink-0 border-b px-4 pt-[calc(0.5rem+var(--safe-top))] pb-2 text-sm"
    >
      <span className="min-w-0 grow">
        <span className="font-medium">{t('sessionLapse.title')}</span>
        <span className="short-viewport:sr-only sr-only sm:not-sr-only">
          {' — '}
          {t('sessionLapse.paused')}
        </span>
      </span>
      <Button
        size="sm"
        className="shrink-0"
        onClick={() => recovery.setOpen(true)}
      >
        {t('sessionLapse.signIn')}
      </Button>
    </Row>
  );
}
