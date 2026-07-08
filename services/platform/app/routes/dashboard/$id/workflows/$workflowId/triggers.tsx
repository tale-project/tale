import { createFileRoute } from '@tanstack/react-router';

import { ContentArea } from '@/app/components/layout/content-area';
import { Triggers } from '@/app/features/workflows/triggers/triggers';
import { seo } from '@/lib/utils/seo';
import { urlParamToSlug } from '@/lib/utils/workflow-slug';

export const Route = createFileRoute(
  '/dashboard/$id/workflows/$workflowId/triggers',
)({
  head: () => ({
    meta: seo('workflowTriggers'),
  }),
  component: TriggersPage,
});

function TriggersPage() {
  const { id: organizationId, workflowId } = Route.useParams();
  const workflowSlug = urlParamToSlug(workflowId);

  return (
    // `Triggers` uses its `workflowId` prop as the workflow ROOT id for trigger
    // APIs and the source-workflow self-exclusion, which key on the slug — pass
    // the decoded slug (not the raw URL param) so a subdirectory workflow
    // (`a/b` ⇄ URL `a__b`) matches itself and is excluded from its own
    // workflow.completed "Source workflow" dropdown. Mirrors the automation
    // Editor tab, which passes `workflowSlug` here.
    <ContentArea gap={6} className="px-4 py-4">
      <Triggers
        workflowId={workflowSlug}
        organizationId={organizationId}
        workflowSlug={workflowSlug}
      />
    </ContentArea>
  );
}
