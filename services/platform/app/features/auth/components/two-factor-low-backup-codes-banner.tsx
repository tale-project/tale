'use client';

import { Link } from '@tanstack/react-router';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

const LOW_BACKUP_CODES_THRESHOLD = 3;

/**
 * Dashboard banner shown when the user has enrolled in 2FA and their
 * backup-code pool has dropped to `LOW_BACKUP_CODES_THRESHOLD` or fewer.
 * Nudges the user toward regenerating a fresh batch in Settings →
 * Account before they lose access to their authenticator and run out.
 *
 * Mirrors `TwoFactorGraceBanner`'s structure deliberately — same query,
 * same markup shape, same warning colours — so the two banners feel
 * consistent when either fires.
 */
export function TwoFactorLowBackupCodesBanner({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('twoFactor');
  const { data: status } = useConvexQuery(api.two_factor.queries.getStatus, {});

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
    <div className="px-4 pt-2">
      <div
        role="alert"
        className="bg-warning/10 border-warning/30 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
      >
        <span className="grow">
          <span className="font-medium">{t(titleKey, { count })}</span>
          {' — '}
          {t('lowBackupCodes.body')}
        </span>
        <Link
          to="/dashboard/$id/settings/account"
          params={{ id: organizationId }}
          className="underline underline-offset-2"
        >
          {t('lowBackupCodes.regenerateLink')}
        </Link>
      </div>
    </div>
  );
}
