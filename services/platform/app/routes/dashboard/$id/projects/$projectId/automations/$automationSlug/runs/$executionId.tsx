import { VStack } from '@tale/ui/layout';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { ContentArea } from '@/app/components/layout/content-area';
import { AutomationDetailShell } from '@/app/features/automations/components/automation-detail-shell';
import { WorkflowDag } from '@/app/features/automations/registry/connected/workflow-dag';
import { AutomationRuntimeProvider } from '@/app/features/automations/runtime/automation-runtime';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/$executionId',
)({
  // `wf` (the workflow slug) is passed by the Runs list so the run view can load
  // the DAG; deep links without it degrade to an empty canvas.
  validateSearch: (search: Record<string, unknown>): { wf?: string } => ({
    wf: typeof search.wf === 'string' ? search.wf : undefined,
  }),
  component: ProjectAutomationRunDetail,
});

/**
 * In-automation run detail for a project-scoped automation — the project-nested twin of the
 * org-level run view. Reuses the global workflow DAG; `projectId` (from the URL)
 * flows into `AutomationRuntime` so bound calls in the run view scope to the project.
 */
function ProjectAutomationRunDetail() {
  const {
    id: organizationId,
    projectId,
    automationSlug,
    executionId,
  } = Route.useParams();
  const { wf } = Route.useSearch();
  const { t } = useT('automations');
  return (
    <AutomationRuntimeProvider
      value={{
        organizationId,
        projectId,
        automationSlug,
        allowlist: [],
        config: {},
      }}
    >
      <AutomationDetailShell
        organizationId={organizationId}
        displayName={automationSlug}
      >
        <ContentArea>
          <VStack gap={4}>
            <Link
              to="/dashboard/$id/projects/$projectId/automations/$automationSlug"
              params={{ id: organizationId, projectId, automationSlug }}
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
