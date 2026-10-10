import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';

import { AutomationEditor } from '@/app/features/automations/components/automation-editor';
import {
  automationEditorSearchSchema,
  type AutomationEditorView,
} from '@/app/features/automations/lib/editor-search';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { paramToAutomationSlug } from '@/lib/automations/slug';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor',
)({
  // See the org-level editor route: `?version=<n>` is the version on the
  // canvas, absent means the latest.
  validateSearch: automationEditorSearchSchema,
  component: ProjectAutomationEditorPage,
});

function ProjectAutomationEditorPage() {
  const { id: organizationId, projectId, automationSlug } = Route.useParams();
  const { version, history, view, node } = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSelectVersion = useCallback(
    (next: number | undefined) => {
      void navigate({
        search: (previous) => ({
          ...(previous.view !== undefined && { view: previous.view }),
          ...(previous.node !== undefined && { node: previous.node }),
          ...(next !== undefined && { version: next }),
        }),
        replace: next === undefined,
      });
    },
    [navigate],
  );
  const onSearchChange = useCallback(
    (change: { view?: AutomationEditorView; node?: string | null }) => {
      void navigate({
        search: (previous) => {
          const next = { ...previous };
          if (change.view !== undefined) next.view = change.view;
          if (change.node === null) delete next.node;
          else if (change.node !== undefined) next.node = change.node;
          return next;
        },
        replace: true,
      });
    },
    [navigate],
  );
  return (
    <AutomationEditor
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
      projectId={asProjectId(projectId)}
      {...(version !== undefined && { version })}
      showVersionHistory={history}
      onSelectVersion={onSelectVersion}
      {...(view !== undefined && { view })}
      {...(node !== undefined && { node })}
      onSearchChange={onSearchChange}
    />
  );
}
