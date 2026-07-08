import { createFileRoute, Outlet, useParams } from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { AutomationsNavigation } from '@/app/features/automations/components/automations-navigation';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

/**
 * "Automations" is the product name. Phase R renamed module paths
 * (`api.automations.*`), schema (`lib/shared/schemas/automations.ts`), config
 * domain (`CONFIG_DOMAINS` `'automations'`), on-disk dirs
 * (`builtin-configs/automations/` + `<org>/automations/`, dual-read against
 * legacy `apps`-named paths — see `convex/automations/file_utils.ts`), Convex
 * tables (`automationInstallations`, `automationProjectBindings`,
 * `automationUpload*`), `automationSlug` fields, and `threadMetadata.kind`
 * `automation_discussion`. The `pack://` asset scheme was never renamed.
 */
export const Route = createFileRoute('/dashboard/$id/automations')({
  head: () => ({
    meta: seo('automations'),
  }),
  component: AutomationsLayout,
});

function AutomationsLayout() {
  const { id: organizationId } = Route.useParams();
  // Non-strict: `automationSlug` is present only on the nested detail routes,
  // which own their whole page shell (breadcrumb + tab strip — see
  // `AutomationDetailShell`), exactly like the workflow and project detail
  // pages. The layout only shells the hub index.
  const { automationSlug } = useParams({ strict: false });
  const { t } = useT('automations');
  if (automationSlug) return <Outlet />;
  return (
    <PageLayout
      organizationId={organizationId}
      header={
        <>
          <AdaptiveHeaderRoot standalone={false}>
            <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
          <AutomationsNavigation organizationId={organizationId} />
        </>
      }
    >
      <Outlet />
    </PageLayout>
  );
}
