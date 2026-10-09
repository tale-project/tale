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
  '/dashboard/$id/automations/$automationSlug/runs/$runId',
)({
  // `?view=steps`, `?node=` and `?item=` or `?pass=` open the run on a view,
  // a step and one of its items, so a link to a part of a run lands there.
  validateSearch: runSearchSchema,
  head: () => ({ meta: seo('automationRuns') }),
  component: AutomationRunPage,
});

function AutomationRunPage() {
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
      // The run id travels as a plain URL segment; the store refuses any id
      // that does not belong to the caller's organization, so an id shaped
      // like another table's reads as "not found" rather than leaking.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a route param is a string; the server validates it
      runId={runId}
      search={search}
      onSearchChange={onSearchChange}
    />
  );
}
