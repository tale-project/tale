import { createFileRoute, Outlet } from '@tanstack/react-router';

import { AutomationDetailShell } from '@/app/features/automations/components/automation-detail-shell';
import { ensureAdaptedQueryData } from '@/app/lib/backend/prefetch';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { i18n } from '@/lib/i18n/i18n';
import { automationDisplayName } from '@/lib/shared/schemas/automation_presentation';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug',
)({
  loader: async ({
    context,
    params,
  }): Promise<{ automationName: string | undefined }> => {
    // Warm the gating automation query so the breadcrumb paints without a
    // skeleton — the list's row-hover preload runs this too, so it resolves
    // from cache on that common path. Awaited so the display name reaches
    // `head()` for the document title, as the project detail does; a failed
    // fetch falls back to the generic `metadata.automation` title, and the
    // shell's own query still surfaces the real not-found state.
    const name = paramToAutomationSlug(params.automationSlug);
    const automation = await ensureAdaptedQueryData(
      context.queryClient,
      'automations/queries:getAutomation',
      { organizationId: params.id, name },
    ).catch((error: unknown) => {
      console.warn('Failed to load automation for document title', error);
      return null;
    });
    return {
      automationName:
        automation === null
          ? undefined
          : automationDisplayName(automation.presentation, name, i18n.language),
    };
  },
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
