import { buttonVariants } from '@tale/ui/button';
import { Link } from '@tanstack/react-router';

import { DashboardEntryFailure } from '@/app/components/layout/dashboard-entry-failure';
import { useUserOrganizationsWithDetails } from '@/app/features/organization/hooks/queries';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

/** Why a switch did not happen: what it threw, or that it never finished. */
export type OrgSwitchFailureCause = { error: unknown } | { timedOut: true };

/**
 * A switch to another organization that failed, where the switching page
 * (`routes/dashboard/switching.tsx`) and the dashboard's sync of the session
 * to its address (`routes/dashboard/$id.tsx`) held their spinner for good
 * before. It names the organization, says why (the refusal's words, a lost
 * connection, or that the switch never finished), and offers Try again and
 * the way back: the organization the session is still in, or Home when that
 * is not one of the person's own, which opens one that is. The way back
 * replaces the failed address, so Back does not switch again.
 */
export function OrgSwitchFailure({
  organizationId,
  activeOrganizationId,
  cause,
  onRetry,
}: {
  /** The organization the switch was to. */
  organizationId: string;
  /** The organization the session is still in. */
  activeOrganizationId: string | null | undefined;
  cause: OrgSwitchFailureCause;
  onRetry: () => void;
}) {
  const { t } = useT('navigation');
  const { t: tCommon } = useT('common');
  const { organizations } = useUserOrganizationsWithDetails();
  const name = organizations?.find(
    (o) => o.organizationId === organizationId,
  )?.name;
  const back =
    activeOrganizationId === organizationId
      ? undefined
      : organizations?.find((o) => o.organizationId === activeOrganizationId);

  return (
    <DashboardEntryFailure
      title={
        name === undefined
          ? t('orgSwitcher.switchFailedUnnamed')
          : t('orgSwitcher.switchFailed', { name })
      }
      description={
        'timedOut' in cause
          ? t('orgSwitcher.switchTimedOut')
          : failureDetail(cause.error)
      }
      onRetry={onRetry}
      retrying={false}
      wayBack={
        back === undefined ? (
          <Link
            to="/dashboard"
            replace
            className={buttonVariants({ variant: 'secondary' })}
          >
            {tCommon('notFound.backToDashboard')}
          </Link>
        ) : (
          <Link
            to="/dashboard/$id"
            params={{ id: back.organizationId }}
            replace
            className={buttonVariants({ variant: 'secondary' })}
          >
            {t('orgSwitcher.backTo', { name: back.name })}
          </Link>
        )
      }
    />
  );
}
