import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';

import {
  LazyAutomationEditor,
  loadAutomationEditor,
} from '@/app/features/automations/components/lazy-automation-pages';
import { automationEditorSearchSchema } from '@/app/features/automations/lib/editor-search';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { paramToAutomationSlug } from '@/lib/automations/slug';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor',
)({
  // See the org-level editor route: `?version=<n>` is the version on the
  // canvas, absent means the latest.
  validateSearch: automationEditorSearchSchema,
  loader: () => {
    void loadAutomationEditor();
  },
  component: ProjectAutomationEditorPage,
});

function ProjectAutomationEditorPage() {
  const { id: organizationId, projectId, automationSlug } = Route.useParams();
  const { version, history } = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSelectVersion = useCallback(
    (next: number | undefined) => {
      void navigate({
        search: next === undefined ? {} : { version: next },
        replace: next === undefined,
      });
    },
    [navigate],
  );
  return (
    <LazyAutomationEditor
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
      projectId={asProjectId(projectId)}
      {...(version !== undefined && { version })}
      showVersionHistory={history}
      onSelectVersion={onSelectVersion}
    />
  );
}
