import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';

import { AutomationEditor } from '@/app/features/automations/components/automation-editor';
import { automationEditorSearchSchema } from '@/app/features/automations/lib/editor-search';
import { paramToAutomationSlug } from '@/lib/automations/slug';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug/editor',
)({
  // `?version=<n>` shows a stored version on the canvas; absent means the
  // latest. It lives in the URL so a Versions row, a shared link and the
  // editor's own picker all land on the same picture.
  validateSearch: automationEditorSearchSchema,
  component: AutomationEditorPage,
});

function AutomationEditorPage() {
  const { id: organizationId, automationSlug } = Route.useParams();
  const { version } = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSelectVersion = useCallback(
    (next: number | undefined) => {
      void navigate({
        search: next === undefined ? {} : { version: next },
        // Returning to the latest (after a save appends one) corrects the URL
        // rather than adding a history entry; picking a version is a move.
        replace: next === undefined,
      });
    },
    [navigate],
  );
  return (
    <AutomationEditor
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
      {...(version !== undefined && { version })}
      onSelectVersion={onSelectVersion}
    />
  );
}
