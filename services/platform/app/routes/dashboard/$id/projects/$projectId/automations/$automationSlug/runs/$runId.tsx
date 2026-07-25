import { createFileRoute } from '@tanstack/react-router';

import { RunDetail } from '@/app/features/automations/components/run-detail';
import type { Id } from '@/convex/_generated/dataModel';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/$runId',
)({
  head: () => ({
    meta: seo('automationRuns'),
  }),
  component: ProjectAutomationRunPage,
});

function ProjectAutomationRunPage() {
  const { id: organizationId, automationSlug, runId } = Route.useParams();
  return (
    <RunDetail
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
      // The path param is a raw string; the query narrows/validates it.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- route param to Convex id, same cast the org-level route uses
      runId={runId as Id<'automationRuns'>}
    />
  );
}
