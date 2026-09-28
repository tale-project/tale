import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { useT } from '@tale/ui/i18n/client';

import type { useSessionLapseRedirect } from '@/app/hooks/use-session-lapse-redirect';

/** Keep the dashboard mounted until the person chooses to leave its drafts. */
export function SessionLapseRecovery({
  recovery,
}: {
  recovery: ReturnType<typeof useSessionLapseRedirect>;
}) {
  const { t } = useT('auth');
  if (!recovery.isLapsed) return null;
  return (
    <>
      {!recovery.open && (
        // `z-50`, the page's sticky headers' layer: rendered after the page,
        // the notice paints over them, and every dialog and sheet, portaled
        // to `<body>` after the app root, still paints over it.
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
  );
}
