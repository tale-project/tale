import { SkeletonText } from '@tale/ui/skeleton';
import { createFileRoute } from '@tanstack/react-router';

import { ContentArea } from '@/app/components/layout/content-area';
import {
  automationSlugToParam,
  paramToAutomationSlug,
} from '@/lib/shared/schemas/automations';
import { lazyComponent } from '@/lib/utils/lazy-component';

/**
 * A project-bound automation's bundled view as a first-class PROJECT tab —
 * a sibling of `automations/…` (NOT nested under it) on purpose: the project
 * shell bare-passes automation-detail children to the Automations chrome,
 * while `views/…` stays inside the shell so the project tab strip (with this
 * view's tab active) keeps framing the page.
 */
function ViewChunkFallback() {
  return (
    <ContentArea gap={6} className="mx-auto max-w-3xl px-4 py-4">
      <SkeletonText lines={6} />
    </ContentArea>
  );
}

const ProjectAutomationViewPage = lazyComponent(
  () =>
    import('@/app/features/automations/components/project-automation-view-page').then(
      (mod) => ({ default: mod.ProjectAutomationViewPage }),
    ),
  { loading: () => <ViewChunkFallback /> },
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/views/$automationSlug/$viewId',
)({
  // Same `/` ↔ `__` codec as the automations `$automationSlug` layouts: a
  // path-shaped slug is one URL segment here too.
  params: {
    parse: (raw: { automationSlug: string; viewId: string }) => ({
      automationSlug: paramToAutomationSlug(raw.automationSlug),
      viewId: raw.viewId,
    }),
    stringify: (parsed: { automationSlug: string; viewId: string }) => ({
      automationSlug: automationSlugToParam(parsed.automationSlug),
      viewId: parsed.viewId,
    }),
  },
  // Warm the page chunk during the loader (tab links preload on render).
  loader: () => {
    void import('@/app/features/automations/components/project-automation-view-page');
  },
  component: ProjectViewRoute,
});

function ProjectViewRoute() {
  const { id, projectId, automationSlug, viewId } = Route.useParams();
  return (
    <ProjectAutomationViewPage
      organizationId={id}
      projectId={projectId}
      automationSlug={automationSlug}
      viewId={viewId}
    />
  );
}
