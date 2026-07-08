import { Heading } from '@tale/ui/heading';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import {
  createFileRoute,
  Link,
  Outlet,
  useParams,
} from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { useAutomations } from '@/app/features/automations/hooks/use-automations';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
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

/** On an automation's detail route, the header becomes a clickable breadcrumb
 *  back to Automations (mirrors the project detail breadcrumb) —
 *  `Automations / <automation name>`. */
function AutomationBreadcrumb({
  organizationId,
  automationSlug,
  automationsTitle,
}: {
  organizationId: string;
  automationSlug: string;
  automationsTitle: string;
}) {
  const { automations, isLoading } = useAutomations(organizationId);
  const app = automations.find((a) => a.slug === automationSlug);
  return (
    <Heading level={1} size="base" truncate>
      <Link
        to="/dashboard/$id/automations"
        params={{ id: organizationId }}
        className={cn(
          'hidden md:inline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          'text-muted-foreground cursor-pointer',
        )}
      >
        {automationsTitle}&nbsp;&nbsp;
      </Link>
      <span className="text-foreground inline-flex items-center gap-2">
        <span className="hidden md:inline">/&nbsp;</span>
        <Skeletonize loading={isLoading && !app} label={automationsTitle}>
          {app ? (
            app.name
          ) : (
            <SkeletonBox>
              <span className="inline-block h-4 w-32 align-middle" />
            </SkeletonBox>
          )}
        </Skeletonize>
      </span>
    </Heading>
  );
}

function AutomationsLayout() {
  const { id: organizationId } = Route.useParams();
  // Non-strict: `automationSlug` is present only on the nested detail route, absent on
  // the hub index — exactly when we want the breadcrumb vs. the plain title.
  const { automationSlug } = useParams({ strict: false });
  const { t } = useT('automations');
  return (
    <PageLayout
      organizationId={organizationId}
      header={
        <AdaptiveHeaderRoot standalone={false}>
          {automationSlug ? (
            <AutomationBreadcrumb
              organizationId={organizationId}
              automationSlug={automationSlug}
              automationsTitle={t('title')}
            />
          ) : (
            <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
          )}
        </AdaptiveHeaderRoot>
      }
    >
      <Outlet />
    </PageLayout>
  );
}
