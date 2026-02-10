import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Workflow, Sparkles } from 'lucide-react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { DataTableEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';
import { AutomationsClient } from '@/app/features/automations/components/automations-client';
import { AutomationsTableSkeleton } from '@/app/features/automations/components/automations-table-skeleton';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/automations/')({
  component: AutomationsPage,
});

function AutomationsEmptyState({ organizationId }: { organizationId: string }) {
  const { t: tEmpty } = useT('emptyStates');
  const { t: tAutomations } = useT('automations');

  return (
    <ContentWrapper>
      <DataTableEmptyState
        icon={Workflow}
        title={tEmpty('automations.title')}
        description={tEmpty('automations.description')}
        actionMenu={
          <DataTableActionMenu
            label={tAutomations('createWithAI')}
            icon={Sparkles}
            href={`/dashboard/${organizationId}/chat`}
          />
        }
      />
    </ContentWrapper>
  );
}

function AutomationsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const { data: memberContext, isLoading: isMemberLoading } = useQuery(
    convexQuery(api.members.queries.getCurrentMemberContext, {
      organizationId,
    }),
  );
  const { data: hasAutomations, isLoading: isAutomationsLoading } = useQuery(
    convexQuery(api.wf_definitions.queries.hasAutomations, {
      organizationId,
    }),
  );

  if (isMemberLoading || isAutomationsLoading) {
    return (
      <ContentWrapper>
        <AutomationsTableSkeleton organizationId={organizationId} />
      </ContentWrapper>
    );
  }

  const userRole = (memberContext?.role ?? '').toLowerCase();
  if (userRole !== 'admin' && userRole !== 'developer') {
    return <AccessDenied message={t('automations')} />;
  }

  if (!hasAutomations) {
    return <AutomationsEmptyState organizationId={organizationId} />;
  }

  return (
    <ContentWrapper>
      <AutomationsClient organizationId={organizationId} />
    </ContentWrapper>
  );
}
