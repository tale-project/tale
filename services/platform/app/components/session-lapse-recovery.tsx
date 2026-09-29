import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
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
  /** Show the standing notice in the caller's flow instead of above the
   * page; returns the release. */
  claim: () => () => void;
}

const NoticeHostContext = createContext<NoticeHost | null>(null);

/**
 * Keep the dashboard mounted until the person chooses to leave its drafts:
 * the confirmation, and after Stay here the standing notice that reopens it.
 * A layout with an alert stack shows that notice in its own flow
 * ({@link SessionLapseNotice}); a dashboard page without one gets it here, in
 * the flow at the top of the window.
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
  // The notice floated over the top of such a page and, on a narrow window,
  // covered its header or back link. In the flow it pushes the page down;
  // while it stands, the page is bounded to the rest of the window, so one
  // exactly the viewport tall still scrolls all of its content into view.
  // The frame is there whether or not it stands, so the page never remounts.
  const unhosted = recovery.isLapsed && claims === 0;
  return (
    <NoticeHostContext.Provider value={host}>
      <div className="flex h-full flex-col">
        {unhosted && <StandingNotice recovery={recovery} />}
        <div className={cn('min-h-0 flex-1', unhosted && '*:max-h-full')}>
          {children}
        </div>
      </div>
      {recovery.isLapsed && (
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
      )}
    </NoticeHostContext.Provider>
  );
}

/**
 * The standing notice as a shell alert: in the flow above the page's header,
 * so the header's title, navigation and actions stay usable at every width,
 * which a notice floating over them was not on a phone.
 */
export function SessionLapseNotice() {
  const host = useContext(NoticeHostContext);
  const claim = host?.claim;
  useLayoutEffect(() => claim?.(), [claim]);
  if (!host?.recovery.isLapsed) return null;
  return <StandingNotice recovery={host.recovery} />;
}

/**
 * The notice's one row, wherever it stands. A narrow or short viewport keeps
 * it to its title and Sign in; the sentence stays for screen readers. It pads
 * the notch itself, since it sits above the header that otherwise would; the
 * shell's header drops its own pad while it stands
 * (`data-session-lapse-notice`, `layout/shell-mobile-header.tsx`).
 *
 * While the confirmation is open the notice steps aside, unseen and out of
 * the accessibility tree, but keeps its place: removed, it grew the page
 * behind the dialog by its own height and shrank it again on Stay here, and
 * the focus had no Sign in to come back to.
 */
function StandingNotice({ recovery }: { recovery: SessionLapseRecoveryState }) {
  const { t } = useT('auth');
  return (
    <Row
      role="status"
      data-session-lapse-notice
      aria-hidden={recovery.open || undefined}
      gap={2}
      className={cn(
        'bg-warning/10 border-warning/30 shrink-0 border-b px-4 pt-[calc(0.5rem+var(--safe-top))] pb-2 text-sm',
        recovery.open && 'invisible',
      )}
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
