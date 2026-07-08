import { VStack } from '@tale/ui/layout';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { ContentArea } from '@/app/components/layout/content-area';
import { AutomationDetailShell } from '@/app/features/automations/components/automation-detail-shell';
import { WorkflowDag } from '@/app/features/automations/registry/connected/workflow-dag';
import { AutomationRuntimeProvider } from '@/app/features/automations/runtime/automation-runtime';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug/runs/$executionId',
)({
  // `wf` (the workflow slug) is passed by the Runs list so the run view can load
  // the DAG; deep links without it degrade to an empty canvas.
  validateSearch: (search: Record<string, unknown>): { wf?: string } => ({
    wf: typeof search.wf === 'string' ? search.wf : undefined,
  }),
  component: AutomationRunDetail,
});

/**
 * In-automation run detail — **reuses the global workflow DAG** with live per-node
 * status (the same `WorkflowSteps` canvas the workflow editor uses), rather
 * than a bespoke per-automation run view. The rich per-step detail (transcript / gate /
 * artifact) lives in-context on the Task (via the embedded run), per the
 * "reuse global for standalone display, fuse detail into domain components" split.
 */
function AutomationRunDetail() {
  const { id: organizationId, automationSlug, executionId } = Route.useParams();
  const { wf } = Route.useSearch();
  const { t } = useT('automations');
  return (
    <AutomationRuntimeProvider
      value={{ organizationId, automationSlug, allowlist: [], config: {} }}
    >
      <AutomationDetailShell
        organizationId={organizationId}
        displayName={automationSlug}
      >
        <ContentArea>
          <VStack gap={4}>
            <Link
              to="/dashboard/$id/automations/$automationSlug"
              params={{ id: organizationId, automationSlug }}
              className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
            >
              <ArrowLeft className="size-4" />
              {t('runs.backToApp')}
            </Link>
            {wf ? (
              <WorkflowDag workflowSlug={wf} executionId={executionId} />
            ) : null}
          </VStack>
        </ContentArea>
      </AutomationDetailShell>
    </AutomationRuntimeProvider>
  );
}
