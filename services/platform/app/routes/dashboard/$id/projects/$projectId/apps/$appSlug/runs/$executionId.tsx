import { VStack } from '@tale/ui/layout';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { useAppPackLabels } from '@/app/features/apps/hooks/use-app-pack-labels';
import { WorkflowDag } from '@/app/features/apps/registry/connected/workflow-dag';
import { AppRuntimeProvider } from '@/app/features/apps/runtime/app-runtime';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/apps/$appSlug/runs/$executionId',
)({
  // `wf` (the workflow slug) is passed by the Runs list so the run view can load
  // the DAG; deep links without it degrade to an empty canvas.
  validateSearch: (search: Record<string, unknown>): { wf?: string } => ({
    wf: typeof search.wf === 'string' ? search.wf : undefined,
  }),
  component: ProjectAppRunDetail,
});

/**
 * In-app run detail for a project-scoped app — the project-nested twin of the
 * org-level run view. Reuses the global workflow DAG; `projectId` (from the URL)
 * flows into `AppRuntime` so bound calls in the run view scope to the project.
 */
function ProjectAppRunDetail() {
  const {
    id: organizationId,
    projectId,
    appSlug,
    executionId,
  } = Route.useParams();
  const { wf } = Route.useSearch();
  const { t } = useT('apps');
  const { labels } = useAppPackLabels(organizationId, appSlug);
  return (
    <AppRuntimeProvider
      value={{
        organizationId,
        projectId,
        appSlug,
        allowlist: [],
        labels,
        config: {},
      }}
    >
      <VStack gap={4}>
        <Link
          to="/dashboard/$id/projects/$projectId/apps/$appSlug"
          params={{ id: organizationId, projectId, appSlug }}
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" />
          {t('runs.backToApp', { defaultValue: 'Back to app' })}
        </Link>
        {wf ? (
          <WorkflowDag workflowSlug={wf} executionId={executionId} />
        ) : null}
      </VStack>
    </AppRuntimeProvider>
  );
}
