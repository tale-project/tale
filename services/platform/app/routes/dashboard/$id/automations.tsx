import { createFileRoute, Outlet } from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { ActiveEditorProvider } from '@/app/components/ui/editor';
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
  return (
    <ActiveEditorProvider>
      <PageLayout
        organizationId={organizationId}
        header={
          <AdaptiveHeaderRoot>
            <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
        }
      >
        <Outlet />
      </PageLayout>
    </ActiveEditorProvider>
  );
}
