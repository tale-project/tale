import { createFileRoute, Outlet, useMatch } from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { ActiveEditorProvider } from '@/app/components/ui/editor';
import { AutomationBreadcrumbs } from '@/app/features/automations/components/automation-breadcrumbs';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/automations')({
  head: () => ({ meta: seo('automations') }),
  component: AutomationsLayout,
});

/**
 * Shell for the automations area — the listing, one automation's canvas, and
 * one run all render under this header, which owns the page's only `h1`.
 *
 * On the hub the title is plain "Automations". On a detail or run route the
 * header becomes the breadcrumb trail (`Automations / <name>`, the name
 * doubling as the sibling switcher) so there is always a way back to the
 * list. Either way the header ends in the shared
 * divider — no tab strip follows in this area, so the row carries its own
 * border, exactly like the Projects list.
 *
 * `ActiveEditorProvider` is the registry the automation page's Save/Discard
 * cluster reads; this layout deliberately renders no cluster of its own, so the
 * page keeps exactly one. Navigation blocking needs nothing here: the dashboard
 * layout mounts the single `DirtyBlockerProvider`, and an editor that registers
 * a dirty source arms it.
 *
 * Each page owns its own content shell — the listing and a run read at the
 * configuration measure, one automation's canvas needs the full width — so
 * there is no area-wide `ContentArea` to override.
 */
function AutomationsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('automations');
  const detailMatch = useMatch({
    from: '/dashboard/$id/automations/$automationSlug',
    shouldThrow: false,
  });
  const automationSlug =
    detailMatch !== undefined
      ? paramToAutomationSlug(detailMatch.params.automationSlug)
      : undefined;

  return (
    <ActiveEditorProvider>
      <PageLayout
        organizationId={organizationId}
        header={
          <AdaptiveHeaderRoot standalone={false} showBorder className="gap-2">
            {automationSlug !== undefined ? (
              <AutomationBreadcrumbs
                organizationId={organizationId}
                automationSlug={automationSlug}
              />
            ) : (
              <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
            )}
          </AdaptiveHeaderRoot>
        }
      >
        <Outlet />
      </PageLayout>
    </ActiveEditorProvider>
  );
}
