import { createFileRoute } from '@tanstack/react-router';

import { RunDetail } from '@/app/features/automations/components/run-detail';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug/runs/$runId',
)({
  head: () => ({ meta: seo('automationRuns') }),
  component: AutomationRunPage,
});

function AutomationRunPage() {
  const { id: organizationId, automationSlug, runId } = Route.useParams();
  return (
    <RunDetail
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
      // The run id travels as a plain URL segment; the store refuses any id
      // that does not belong to the caller's organization, so an id shaped
      // like another table's reads as "not found" rather than leaking.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a route param is a string; the server validates it
      runId={runId}
    />
  );
}
