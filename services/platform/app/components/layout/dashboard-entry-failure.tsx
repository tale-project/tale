import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { FullPageCenter } from '@tale/ui/full-page-center';
import { VStack } from '@tale/ui/layout';
import { toast } from '@tale/ui/use-toast';
import { useState, type ReactNode } from 'react';

import { useAuth } from '@/app/hooks/use-session-user';
import { redirectToLogIn } from '@/app/lib/auth/log-in-redirect';
import { useT } from '@/lib/i18n/client';

/**
 * The page a signed-in person sees when the way into the dashboard failed:
 * the layout's account read (`routes/dashboard.tsx`), or the organization
 * list and the entry into an organization (`routes/dashboard/index.tsx`).
 * Each held its frame forever before, with no word and no way out; this
 * says what failed and offers the ways on. Signing in again ends the
 * session first: the sign-in page sends a live session straight back to
 * the dashboard. A session an authenticating proxy asserted is the proxy's
 * to end, as the account menu has it, so it is offered Try again alone.
 */
export function DashboardEntryFailure({
  title,
  description,
  onRetry,
  retrying,
}: {
  /** What failed, above its detail. */
  title?: string;
  description?: ReactNode;
  onRetry: () => void;
  /** The retry is under way: Try again shows it is busy. */
  retrying: boolean;
}) {
  const { signOut, proxied } = useAuth();
  const { t } = useT('auth');
  const { t: tCommon } = useT('common');
  const [leaving, setLeaving] = useState(false);

  const signInAgain = async () => {
    setLeaving(true);
    try {
      await signOut();
    } catch (error) {
      console.warn('[auth] Ending the session to sign in again failed', error);
      setLeaving(false);
      toast({
        title: t('userButton.toast.signOutFailed'),
        variant: 'destructive',
      });
      return;
    }
    redirectToLogIn();
  };

  return (
    <FullPageCenter>
      <VStack gap={3}>
        <Alert variant="destructive" title={title} description={description} />
        <Button variant="secondary" isLoading={retrying} onClick={onRetry}>
          {tCommon('actions.tryAgain')}
        </Button>
        {!proxied && (
          <Button
            variant="secondary"
            isLoading={leaving}
            onClick={() => void signInAgain()}
          >
            {t('accountUnavailable.signInAgain')}
          </Button>
        )}
      </VStack>
    </FullPageCenter>
  );
}
