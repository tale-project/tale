import { ContentArea } from '@tale/ui/content-area';
import { createFileRoute } from '@tanstack/react-router';

import { AutomationsList } from '@/app/features/automations/components/automations-list';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/',
)({
  component: ProjectAutomationsIndexPage,
});

function ProjectAutomationsIndexPage() {
  const { id: organizationId, projectId } = Route.useParams();
  return (
    // Same frame as the org-level Automations list and the Knowledge tables:
    // the project shell hands this tab a bounded flex box, and `list` passes
    // that bound down so the table scrolls inside its own scrollport.
    <ContentArea variant="list">
      <AutomationsList
        organizationId={organizationId}
        projectId={asProjectId(projectId)}
      />
    </ContentArea>
  );
}
