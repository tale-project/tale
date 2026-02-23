import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { AutomationsTable } from '@/app/features/automations/components/automations-table';
import {
  useApproxAutomationCount,
  useListAutomationsPaginated,
} from '@/app/features/automations/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/automations/')({
  head: () => ({
    meta: seo('automations'),
  }),
  pendingComponent: () => null,
  pendingMs: 0,
  loader: async ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.wf_definitions.queries.listAutomationsPaginated, {
        organizationId: params.id,
        paginationOpts: { numItems: 10, cursor: null },
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

function AutomationsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const ability = useAbility();
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const { isLoading: isMemberLoading } = useCurrentMemberContext(
    organizationId,
    isAuthLoading || !isAuthenticated,
  );
  const { data: count } = useApproxAutomationCount(organizationId);

  const paginatedResult = useListAutomationsPaginated({
    organizationId,
    initialNumItems: 10,
  });

  if (count === undefined) return null;

  if (
    !isAuthLoading &&
    !isMemberLoading &&
    ability.cannot('write', 'wfDefinitions')
  ) {
    return <AccessDenied message={t('automations')} />;
  }

  return (
    <AutomationsTable
      organizationId={organizationId}
      paginatedResult={paginatedResult}
    />
  );
}
