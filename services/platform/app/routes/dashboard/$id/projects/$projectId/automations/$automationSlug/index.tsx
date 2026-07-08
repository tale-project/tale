import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { AutomationPage } from '@/app/features/automations/components/automation-page';
import { resolvesToAutomation } from '@/app/features/automations/utils/resolve-legacy-automation';

// See the org-level mirror (`automations/$automationSlug/index.tsx`) for what each
// key drives: `tab` (the automation's tab strip), `panel`/`step`/`execution`
// (the Editor tab's workflow canvas state), `query`/`status`/`triggeredBy`/
// `dateFrom`/`dateTo` (the Executions tab's filters).
const searchSchema = z.object({
  tab: z.string().optional(),
  panel: z.string().optional(),
  step: z.string().optional(),
  execution: z.string().optional(),
  query: z.string().optional(),
  status: z.string().optional(),
  triggeredBy: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug/',
)({
  validateSearch: searchSchema,
  // D3, mirrored from the org-level route: a real automation always wins;
  // only an unresolved slug falls back to the standalone (org-level, there is
  // no project-scoped variant) workflow route.
  beforeLoad: async ({ context, params }) => {
    const isReal = await resolvesToAutomation(
      context,
      params.id,
      params.automationSlug,
    );
    if (!isReal) {
      throw redirect({
        to: '/dashboard/$id/workflows/$workflowId',
        params: { id: params.id, workflowId: params.automationSlug },
        replace: true,
      });
    }
  },
  component: ProjectAutomationIndexRoute,
});

/**
 * A project-scoped automation's page, reached from its tab in the project shell. The
 * bound project comes straight from the URL and flows into `AutomationRuntime` as
 * `$projectId`, so the automation's views/actions scope to this project.
 */
function ProjectAutomationIndexRoute() {
  const { id: organizationId, projectId, automationSlug } = Route.useParams();
  return (
    <AutomationPage
      organizationId={organizationId}
      automationSlug={automationSlug}
      projectId={projectId}
    />
  );
}
