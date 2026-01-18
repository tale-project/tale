import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { z } from 'zod';
import { api } from '@/convex/_generated/api';
import { AutomationsClient } from '@/app/features/automations/components/automations-client';
import { AutomationsTableSkeleton } from '@/app/features/automations/components/automations-table-skeleton';
import { AccessDenied } from '@/app/components/layout/access-denied';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import { DataTableEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';
import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { Workflow, Sparkles } from 'lucide-react';
import { useT } from '@/lib/i18n/client';

const searchSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/automations')({
  validateSearch: searchSchema,
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
  const { query, status } = Route.useSearch();
  const { t } = useT('accessDenied');

  const memberContext = useQuery(api.members.queries.getCurrentMemberContext, {
    organizationId,
  });
  const hasAutomations = useQuery(api.wf_definitions.queries.hasAutomations.hasAutomations, {
    organizationId,
  });

  if (memberContext === undefined || hasAutomations === undefined) {
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

  const hasFilters = query || status;
  if (!hasFilters && !hasAutomations) {
    return <AutomationsEmptyState organizationId={organizationId} />;
  }

  return (
    <ContentWrapper>
      <AutomationsClient
        organizationId={organizationId}
        searchTerm={query}
        status={status ? [status] : undefined}
      />
    </ContentWrapper>
  );
}
