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
import { SettingsMobileBackButton } from '@/app/features/settings/components/settings-mobile-back-button';
import { SettingsRail } from '@/app/features/settings/components/settings-rail';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
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

  // The Governance and API sections render an internally-scrolling content pane
  // (see their `route.tsx`) that needs ContentArea to be a bounded flex parent
  // (`min-h-0 flex-1`) for its `overflow-y-auto` to get a height to scroll
  // within. Every other settings page is a plain scrolling form/table: leaving
  // ContentArea at content height lets the PageLayout scroll container honor
  // ContentArea's own `py-6` bottom padding.
  const usesBoundedLayout =
    location.pathname.includes('/settings/governance') ||
    location.pathname.includes('/settings/api') ||
    location.pathname.includes('/settings/branding');

  return (
    <ActiveEditorProvider>
      <PageLayout
        organizationId={organizationId}
        header={
          <AdaptiveHeaderRoot showBorder standalone={false}>
            <SettingsMobileBackButton organizationId={organizationId} />
            <AdaptiveHeaderTitle>{headerTitle}</AdaptiveHeaderTitle>
            <SettingsEditorActionsSlot />
          </AdaptiveHeaderRoot>
        }
      >
        <SettingsMobileActionBar />
        {/* Left rail (desktop) + content. The rail replaces the former
            horizontal tab strip; on mobile it's hidden and the dedicated
            personal/workspace overview routes drive navigation instead. */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="hidden md:flex">
            <SettingsRail organizationId={organizationId} />
          </div>
          <ContentArea
            className={cn(
              'min-w-0 overflow-y-auto',
              usesBoundedLayout ? 'min-h-0 flex-1' : 'flex-1',
            )}
            variant="page"
            gap={6}
          >
            <Outlet />
          </ContentArea>
        </div>
      </PageLayout>
    </ActiveEditorProvider>
  );
}

/**
 * Reads the active child controller (settings sub-page form) and renders the
 * unified Save/Discard cluster in the settings header. Sub-pages without forms
 * (teams, integrations list, audit logs) clear the active editor and the
 * cluster doesn't render. Replaces the cluster that previously lived in the
 * horizontal tab strip.
 */
function SettingsEditorActionsSlot() {
  const controller = useActiveEditor();
  if (!controller) return null;
  return (
    <div className="ml-auto hidden items-center gap-2 md:flex">
      <EditorActions controller={controller} entityKind="settings" />
    </div>
  );
}

/**
 * Mobile-only bar holding the active settings page's Save/Discard cluster.
 * The desktop equivalent lives in the settings header (`SettingsEditorActionsSlot`),
 * which is `hidden md:flex` — so on small screens the Save/Discard buttons were
 * unreachable. Reads the active editor (set by each form page) and renders the
 * cluster only when one is present. Back navigation lives in the settings header
 * (`SettingsMobileBackButton`, rendered into the mobile top bar).
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
