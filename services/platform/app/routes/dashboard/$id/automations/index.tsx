import { createFileRoute } from '@tanstack/react-router';
import { Workflow, Sparkles } from 'lucide-react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { DataTableEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';
import { AutomationsClient } from '@/app/features/automations/components/automations-client';
import { AutomationsTableSkeleton } from '@/app/features/automations/components/automations-table-skeleton';
import { useWfAutomationCollection } from '@/app/features/automations/hooks/collections';
import { useAutomations } from '@/app/features/automations/hooks/queries';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
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

  const { data: memberContext, isLoading: isMemberLoading } =
    useCurrentMemberContext(organizationId);
  const wfAutomationCollection = useWfAutomationCollection(organizationId);
  const { automations, isLoading: isAutomationsLoading } = useAutomations(
    wfAutomationCollection,
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

  if (!automations || automations.length === 0) {
    return <AutomationsEmptyState organizationId={organizationId} />;
  }

  return (
    <ContentWrapper>
      <AutomationsClient organizationId={organizationId} />
    </ContentWrapper>
  );
}
