import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { FullPageCenter } from '@tale/ui/full-page-center';
import { VStack } from '@tale/ui/layout';
import type { ReactNode } from 'react';

import { useSignInAgain } from '@/app/hooks/use-sign-in-again';
import { useT } from '@/lib/i18n/client';

/**
 * The page a signed-in person sees when the way into the dashboard failed:
 * the layout's account read (`routes/dashboard.tsx`), the organization list
 * and the entry into an organization (`routes/dashboard/index.tsx`), or a
 * switch to another organization (`OrgSwitchFailure`). Each held its frame
 * or its spinner forever before, with no word and no way out; this says what
 * failed and offers the ways on: Try again, and signing in again
 * (`useSignInAgain`), which a session an authenticating proxy asserted is
 * not offered. A failure with a way back that keeps the session, such as the
 * organization a failed switch left the person in, offers that instead of
 * signing in again.
 */
export function DashboardEntryFailure({
  title,
  description,
  onRetry,
  retrying,
  wayBack,
}: {
  /** What failed, above its detail. */
  title?: string;
  description?: ReactNode;
  onRetry: () => void;
  /** The retry is under way: Try again shows it is busy. */
  retrying: boolean;
  /** A way back that keeps the session; it stands where Sign in again would. */
  wayBack?: ReactNode;
}) {
  const { offered, leaving, signInAgain } = useSignInAgain();
  const { t } = useT('auth');
  const { t: tCommon } = useT('common');

  return (
    <FullPageCenter>
      <VStack gap={3}>
        <Alert variant="destructive" title={title} description={description} />
        <Button variant="secondary" isLoading={retrying} onClick={onRetry}>
          {tCommon('actions.tryAgain')}
        </Button>
        {wayBack ??
          (offered && (
            <Button
              variant="secondary"
              isLoading={leaving}
              onClick={() => void signInAgain()}
            >
              {t('accountUnavailable.signInAgain')}
            </Button>
          ))}
      </VStack>
    </FullPageCenter>
  );
}
