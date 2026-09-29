'use client';

import { Link } from '@tanstack/react-router';

import { ShellAlert } from '@/app/components/layout/shell-alert';
import { useTwoFactorStatus } from '@/app/context/account-bootstrap-context';
import { useT } from '@/lib/i18n/client';

const LOW_BACKUP_CODES_THRESHOLD = 3;

/**
 * Dashboard banner shown when the user has enrolled in 2FA and their
 * backup-code pool has dropped to `LOW_BACKUP_CODES_THRESHOLD` or fewer.
 * Nudges the user toward regenerating a fresh batch in Settings →
 * Account before they lose access to their authenticator and run out.
 *
 * Shares `TwoFactorGraceBanner`'s query and its `ShellAlert` row
 * deliberately, so the two banners feel consistent when either fires.
 */
export function TwoFactorLowBackupCodesBanner({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('twoFactor');
  const status = useTwoFactorStatus();

  if (!status || !status.authenticated) return null;
  if (!status.twoFactorEnabled) return null;
  if (
    status.backupCodesRemaining === null ||
    status.backupCodesRemaining > LOW_BACKUP_CODES_THRESHOLD
  ) {
    return null;
  }

  const count = status.backupCodesRemaining;
  const titleKey =
    count === 1 ? 'lowBackupCodes.titleOne' : 'lowBackupCodes.titleOther';

  return (
    <ShellAlert>
      <span className="grow">
        <span className="font-medium">{t(titleKey, { count })}</span>
        {/* Same phone treatment as every dashboard nudge: read out, not
            drawn, so the banner stays one line above the page. */}
        <span className="sr-only sm:not-sr-only">
          {' — '}
          {t('lowBackupCodes.body')}
        </span>
      </span>
      <Link
        to="/dashboard/$id/settings/account"
        params={{ id: organizationId }}
        className="underline underline-offset-2"
      >
        {t('lowBackupCodes.regenerateLink')}
      </Link>
    </ShellAlert>
  );
}
