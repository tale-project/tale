import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';

import {
  AutomationVersionsTab,
  type VersionsView,
} from '@/app/features/automations/components/automation-versions-tab';
import { automationVersionsSearchSchema } from '@/app/features/automations/lib/editor-search';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug/versions/',
)({
  validateSearch: automationVersionsSearchSchema,
  head: () => ({ meta: seo('automationVersions') }),
  component: AutomationVersionsPage,
});

function AutomationVersionsPage() {
  const { id: organizationId, automationSlug } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const onViewChange = useCallback(
    (next: VersionsView) => {
      void navigate({
        search: next === 'versions' ? {} : { tab: next },
        // Switching the view is no move of its own.
        replace: true,
      });
    },
    [navigate],
  );
  return (
    <AutomationVersionsTab
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
      view={tab ?? 'versions'}
      onViewChange={onViewChange}
    />
  );
}
