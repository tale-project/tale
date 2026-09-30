import { createFileRoute, Outlet } from '@tanstack/react-router';

import { AutomationDetailShell } from '@/app/features/automations/components/automation-detail-shell';
import { loadAutomationName } from '@/app/features/automations/lib/load-automation-name';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug',
)({
  loader: async ({
    context,
    params,
  }): Promise<{ automationName: string | undefined }> => ({
    automationName: await loadAutomationName(
      context,
      params.id,
      params.automationSlug,
    ),
  }),
  head: ({ loaderData }) => ({
    meta: seo('automation', loaderData?.automationName),
  }),
  component: AutomationDetailLayout,
});

/**
 * One automation's chrome — breadcrumb, tab strip, editor registry — around
 * its Editor / Versions / Runs pages and its run pages. The shell itself is
 * shared with the project-scoped route family.
 */
function AutomationDetailLayout() {
  const { id: organizationId, automationSlug } = Route.useParams();
  return (
    <AutomationDetailShell
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
    >
      <Outlet />
    </AutomationDetailShell>
  );
}
