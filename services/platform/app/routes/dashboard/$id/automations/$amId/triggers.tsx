import { createFileRoute } from '@tanstack/react-router';

import { Triggers } from '@/app/features/automations/triggers/triggers';
import { seo } from '@/lib/utils/seo';
import { urlParamToSlug } from '@/lib/utils/workflow-slug';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$amId/triggers',
)({
  head: () => ({
    meta: seo('automationTriggers'),
  }),
  component: TriggersPage,
});

function TriggersPage() {
  const { id: organizationId, amId } = Route.useParams();
  const workflowSlug = urlParamToSlug(amId);

  return (
    <Triggers
      automationId={amId}
      organizationId={organizationId}
      orgSlug="default"
      workflowSlug={workflowSlug}
    />
  );
}
