import { createFileRoute } from '@tanstack/react-router';

import {
  LazyRunDetail,
  loadRunDetail,
} from '@/app/features/automations/components/lazy-automation-pages';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/$runId',
)({
  head: () => ({
    meta: seo('automationRuns'),
  }),
  loader: () => {
    void loadRunDetail();
  },
  component: ProjectAutomationRunPage,
});

function ProjectAutomationRunPage() {
  const { id: organizationId, automationSlug, runId } = Route.useParams();
  return (
    <LazyRunDetail
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
      // The path param is a raw string; the query narrows/validates it.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- route param to Convex id, same cast the org-level route uses
      runId={runId}
    />
  );
}
