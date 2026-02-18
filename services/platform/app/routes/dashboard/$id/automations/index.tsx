import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Workflow, Sparkles } from 'lucide-react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { DataTableEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';
import { AutomationsClient } from '@/app/features/automations/components/automations-client';
import { AutomationsTableSkeleton } from '@/app/features/automations/components/automations-table-skeleton';
import {
  useAutomations,
  useApproxAutomationCount,
} from '@/app/features/automations/hooks/queries';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/automations/')({
  loader: async ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.wf_definitions.queries.listAutomations, {
        organizationId: params.id,
      }),
    );
    await context.queryClient.ensureQueryData(
      convexQuery(api.wf_definitions.queries.approxCountAutomations, {
        organizationId: params.id,
      }),
    );
  },
  component: AutomationsPage,
});

function AutomationsEmptyState({ organizationId }: { organizationId: string }) {
  const { t: tEmpty } = useT('emptyStates');
  const { t: tAutomations } = useT('automations');

  return (
    <ContentWrapper className="p-4">
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
  const { data: count } = useApproxAutomationCount(organizationId);
  const { automations, isLoading: isAutomationsLoading } =
    useAutomations(organizationId);

  if (count === 0) {
    return <AutomationsEmptyState organizationId={organizationId} />;
  }

  if (isMemberLoading || isAutomationsLoading) {
    return (
      <ContentWrapper>
        <AutomationsTableSkeleton
          organizationId={organizationId}
          rows={Math.min(count ?? 10, 10)}
        />
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
