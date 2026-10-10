import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';

import { RunDetail } from '@/app/features/automations/components/run-detail';
import {
  applyRunSearchChange,
  type RunSearchChange,
  runSearchSchema,
} from '@/app/features/automations/lib/run-search';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/$runId',
)({
  // `?view=steps`, `?node=` and `?item=` or `?pass=` open the run on a view,
  // a step and one of its items, so a link to a part of a run lands there.
  validateSearch: runSearchSchema,
  head: () => ({
    meta: seo('automationRuns'),
  }),
  component: ProjectAutomationRunPage,
});

function ProjectAutomationRunPage() {
  const { id: organizationId, automationSlug, runId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSearchChange = useCallback(
    (change: RunSearchChange) => {
      void navigate({
        search: (previous) => applyRunSearchChange(previous, change),
        // Following the reader's view and selection is no move of its own.
        replace: true,
      });
    },
    [navigate],
  );
  return (
    <RunDetail
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
      // The path param is a raw string; the query narrows/validates it.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- route param to Convex id, same cast the org-level route uses
      runId={runId}
      search={search}
      onSearchChange={onSearchChange}
    />
  );
}
