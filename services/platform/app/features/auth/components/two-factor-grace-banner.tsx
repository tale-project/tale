'use client';

import { Link } from '@tanstack/react-router';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Banner shown at the top of the dashboard when an org policy requires
 * two-factor authentication and the current user is within their
 * grace window (but has not yet enrolled). Disappears when the user
 * enrols, when policy is disabled, or when grace expires (at which
 * point sign-in itself redirects to the enrolment wall).
 *
 * Uses a local div instead of the shared `Banner` component because we
 * need an inline TanStack Router `<Link>` as the CTA and `Banner`
 * rejects children by design.
 */
export function TwoFactorGraceBanner({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('twoFactor');
  const { data: status } = useConvexQuery(api.two_factor.queries.getStatus, {});

  if (!status || !status.authenticated) return null;
  if (status.decision !== 'grace') return null;
  if (status.graceUntil == null) return null;

  const remainingDays = Math.max(
    1,
    Math.ceil((status.graceUntil - Date.now()) / DAY_MS),
  );
  const titleKey = remainingDays === 1 ? 'grace.titleOne' : 'grace.titleOther';

  return (
    <div className="px-4 pt-2">
      <div
        role="alert"
        className="bg-warning/10 border-warning/30 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
      >
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
      </div>
    </div>
  );
}
