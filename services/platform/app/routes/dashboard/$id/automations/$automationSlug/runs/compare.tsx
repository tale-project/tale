import { createFileRoute } from '@tanstack/react-router';

import { RunComparePage } from '@/app/features/automations/components/run-compare-page';
import { automationDetailPathname } from '@/app/features/automations/lib/detail-paths';
import { runCompareSearchSchema } from '@/app/features/automations/lib/run-search';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug/runs/compare',
)({
  // `?a=<runId>&b=<runId>`: the two runs, so a comparison can be linked.
  validateSearch: runCompareSearchSchema,
  head: () => ({ meta: seo('automationRuns') }),
  component: CompareRunsPage,
});

function CompareRunsPage() {
  const { id: organizationId, automationSlug } = Route.useParams();
  const { a, b } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <RunComparePage
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
      runsPath={`${automationDetailPathname({
        organizationId,
        automationSlug: paramToAutomationSlug(automationSlug),
      })}/runs`}
      {...(a !== undefined && { a })}
      {...(b !== undefined && { b })}
      onSwap={() => {
        void navigate({
          search: {
            ...(b !== undefined && { a: b }),
            ...(a !== undefined && { b: a }),
          },
          replace: true,
        });
      }}
    />
  );
}
