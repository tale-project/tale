'use client';

import { Link } from '@tanstack/react-router';

import { ShellAlert } from '@/app/components/layout/shell-alert';
import { useTwoFactorStatus } from '@/app/context/account-bootstrap-context';
import { useT } from '@/lib/i18n/client';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Banner shown at the top of the dashboard when an org policy requires
 * two-factor authentication and the current user is within their
 * grace window (but has not yet enrolled). Disappears when the user
 * enrols, when policy is disabled, or when grace expires (at which
 * point sign-in itself redirects to the enrolment wall).
 *
 * A `ShellAlert`, like every dashboard nudge, with an inline TanStack
 * Router `<Link>` as its call to action.
 */
export function TwoFactorGraceBanner({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('twoFactor');
  const status = useTwoFactorStatus();

  if (!status || !status.authenticated) return null;
  if (status.decision !== 'grace') return null;
  if (status.graceUntil == null) return null;

  const remainingDays = Math.max(
    1,
    Math.ceil((status.graceUntil - Date.now()) / DAY_MS),
  );
  const titleKey = remainingDays === 1 ? 'grace.titleOne' : 'grace.titleOther';

  return (
    <ShellAlert>
      <span className="grow">
        <span className="font-medium">
          {t(titleKey, { days: remainingDays })}
        </span>
        {' — '}
        {t('grace.body')}
      </span>
      <Link
        to="/dashboard/$id/settings/account"
        params={{ id: organizationId }}
        className="underline underline-offset-2"
      >
        {t('grace.setupLink')}
      </Link>
    </ShellAlert>
  );
}
