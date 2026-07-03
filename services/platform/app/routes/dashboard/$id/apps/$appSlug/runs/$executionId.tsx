import { VStack } from '@tale/ui/layout';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { useAppPackLabels } from '@/app/features/apps/hooks/use-app-pack-labels';
import { WorkflowDag } from '@/app/features/apps/registry/connected/workflow-dag';
import { AppRuntimeProvider } from '@/app/features/apps/runtime/app-runtime';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute(
  '/dashboard/$id/apps/$appSlug/runs/$executionId',
)({
  // `wf` (the workflow slug) is passed by the Runs list so the run view can load
  // the DAG; deep links without it degrade to an empty canvas.
  validateSearch: (search: Record<string, unknown>): { wf?: string } => ({
    wf: typeof search.wf === 'string' ? search.wf : undefined,
  }),
  component: AppRunDetail,
});

/**
 * In-app run detail — **reuses the global workflow DAG** with live per-node
 * status (the same `AutomationSteps` canvas the automations editor uses), rather
 * than a bespoke per-app run view. The rich per-step detail (transcript / gate /
 * artifact) lives in-context on the Task (via the embedded run), per the
 * "reuse global for standalone display, fuse detail into domain components" split.
 */
function AppRunDetail() {
  const { id: organizationId, appSlug, executionId } = Route.useParams();
  const { wf } = Route.useSearch();
  const { t } = useT('apps');
  // WorkflowDag resolves pack `ui.labelKey`s + org via AppRuntime.
  const { labels } = useAppPackLabels(organizationId, appSlug);
  return (
    <AppRuntimeProvider
      value={{ organizationId, appSlug, allowlist: [], labels, config: {} }}
    >
      <VStack gap={4}>
        <Link
          to="/dashboard/$id/apps/$appSlug"
          params={{ id: organizationId, appSlug }}
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" />
          {t('runs.backToApp')}
        </Link>
        {wf ? (
          <WorkflowDag workflowSlug={wf} executionId={executionId} />
        ) : null}
      </VStack>
    </AppRuntimeProvider>
  );
}
