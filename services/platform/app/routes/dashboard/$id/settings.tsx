import { Outlet, createFileRoute, useLocation } from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';
import { PageLayout } from '@/app/components/layout/page-layout';
import {
  ActiveEditorProvider,
  EditorActions,
  useActiveEditor,
} from '@/app/components/ui/editor';
import { SettingsNavigation } from '@/app/features/settings/components/settings-navigation';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings')({
  head: () => ({
    meta: seo('settings'),
  }),
  component: SettingsLayout,
});

function SettingsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t: tNav } = useT('navigation');
  const location = useLocation();

  const headerTitle = tNav('userSettings');

  // The Governance and API sections render their own sidebar + internally
  // scrolling content pane (see their `route.tsx`) and cancel ContentArea's
  // padding with negative margins, so they need ContentArea to be a bounded
  // flex parent (`min-h-0 flex-1`) for their `overflow-y-auto` pane to get a
  // height to scroll within. Every other settings page is a plain scrolling
  // form/table: leaving ContentArea at content height lets the PageLayout
  // scroll container honor ContentArea's own `py-6` bottom padding — with
  // `flex-1` a tall form overflows past that padding and its actions end up
  // flush against the viewport bottom.
  const usesBoundedLayout =
    location.pathname.includes('/settings/governance') ||
    location.pathname.includes('/settings/api');

  return (
    <ActiveEditorProvider>
      <PageLayout
        organizationId={organizationId}
        header={
          <>
            <AdaptiveHeaderRoot standalone={false}>
              <AdaptiveHeaderTitle>{headerTitle}</AdaptiveHeaderTitle>
            </AdaptiveHeaderRoot>
            <div className="hidden md:block">
              <SettingsNavigation organizationId={organizationId} />
            </div>
          </>
        }
      >
        <SettingsMobileActionBar />
        <ContentArea
          className={usesBoundedLayout ? 'min-h-0 flex-1' : undefined}
          variant="page"
          gap={6}
        >
          <Outlet />
        </ContentArea>
      </PageLayout>
    </ActiveEditorProvider>
  );
}

/**
 * Mobile-only bar holding the active settings page's Save/Discard cluster.
 * The desktop equivalent lives in the settings tab strip (`SettingsNavigation`),
 * which is `hidden md:block` — so on small screens the Save/Discard buttons were
 * unreachable. Reads the active editor (set by each form page) and renders the
 * cluster only when one is present. Back navigation lives in the main nav header.
 */
function SettingsMobileActionBar() {
  const controller = useActiveEditor();

  if (!controller) return null;

  return (
    <div className="border-border flex items-center justify-end gap-2 border-b px-4 py-2 md:hidden">
      <EditorActions controller={controller} entityKind="settings" />
    </div>
  );
}
