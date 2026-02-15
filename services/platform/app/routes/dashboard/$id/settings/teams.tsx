import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { TeamsEmptyState } from '@/app/features/settings/teams/components/teams-empty-state';
import { TeamsTable } from '@/app/features/settings/teams/components/teams-table';
import { TeamsTableSkeleton } from '@/app/features/settings/teams/components/teams-table-skeleton';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/teams')({
  head: () => ({
    meta: seo({
      title: 'Teams - Tale',
      description: 'Create and manage teams within your organization.',
    }),
  }),
  component: TeamsSettingsPage,
});

function TeamsSettingsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const { data: memberContext, isLoading: isMemberLoading } =
    useCurrentMemberContext(organizationId);

  if (isMemberLoading) {
    return <TeamsTableSkeleton organizationId={organizationId} />;
  }

  if (!memberContext || !memberContext.isAdmin) {
    return <AccessDenied message={t('teams')} />;
  }

  return <TeamsContent organizationId={organizationId} />;
}

function TeamsContent({ organizationId }: { organizationId: string }) {
  const { teams, isLoading } = useTeams();

  if (isLoading) {
    return <TeamsTableSkeleton organizationId={organizationId} />;
  }

  if (!teams || teams.length === 0) {
    return <TeamsEmptyState organizationId={organizationId} />;
  }

  return <TeamsTable teams={teams} organizationId={organizationId} />;
}
