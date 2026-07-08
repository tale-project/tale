import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AutomationPage } from '@/app/features/automations/components/automation-page';

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
  component: ProjectAutomationIndexRoute,
});

/**
 * A project-scoped automation's page, reached from the Automations catalog. The
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
