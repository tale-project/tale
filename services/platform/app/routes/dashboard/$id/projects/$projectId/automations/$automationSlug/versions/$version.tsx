import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';

import {
  VersionComparePage,
  type VersionCompareSearch,
} from '@/app/features/automations/components/versions/version-compare-page';
import {
  automationVersionCompareSearchSchema,
  versionParam,
} from '@/app/features/automations/lib/editor-search';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug/versions/$version',
)({
  validateSearch: automationVersionCompareSearchSchema,
  head: () => ({ meta: seo('automationVersionCompare') }),
  component: ProjectAutomationVersionComparePage,
});

function ProjectAutomationVersionComparePage() {
  const {
    id: organizationId,
    projectId,
    automationSlug,
    version,
  } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSearchChange = useCallback(
    (next: VersionCompareSearch) => {
      void navigate({
        search: {
          ...(next.from !== undefined && { from: next.from }),
          ...(next.view !== undefined && { view: next.view }),
          ...(next.node !== undefined && { node: next.node }),
        },
        // Following the reader's choices is no move of its own.
        replace: true,
      });
    },
    [navigate],
  );
  // The history belongs to the automation; only the links stay under the
  // project.
  return (
    <VersionComparePage
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
      projectId={projectId}
      version={versionParam(version)}
      search={search}
      onSearchChange={onSearchChange}
    />
  );
}
