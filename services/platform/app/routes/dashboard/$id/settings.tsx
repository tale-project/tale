import {
  Link,
  Outlet,
  createFileRoute,
  useLocation,
} from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';

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

  const settingsRoot = `/dashboard/${organizationId}/settings`;
  const personalRoot = `${settingsRoot}/personal`;
  const isAtIndex =
    location.pathname === settingsRoot || location.pathname === personalRoot;
  // Show the mobile back-to-settings link only when we're at a direct child of
  // `/settings` (e.g. `/settings/account`). Deeper routes — `governance/<sub>`,
  // `integrations/<sub>` — own their own intra-section back link and would
  // otherwise stack two "Back" bars on top of each other.
  const settingsPath = location.pathname.startsWith(`${settingsRoot}/`)
    ? location.pathname.slice(settingsRoot.length + 1)
    : '';
  const isDirectChild =
    settingsPath !== '' && !settingsPath.replace(/\/$/, '').includes('/');
  const isUserScope =
    location.pathname.includes('/settings/account') ||
    location.pathname.includes('/settings/personalization') ||
    location.pathname.endsWith('/settings/personal') ||
    location.pathname.includes('/settings/personal/');
  const headerTitle = isUserScope ? tNav('userSettings') : tNav('orgSettings');

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
        <SettingsMobileActionBar
          showBack={!isAtIndex && isDirectChild}
          isUserScope={isUserScope}
          organizationId={organizationId}
        />
        <ContentArea className="min-h-0 flex-1" variant="page" gap={6}>
          <Outlet />
        </ContentArea>
      </PageLayout>
    </ActiveEditorProvider>
  );
}

interface SettingsMobileActionBarProps {
  showBack: boolean;
  isUserScope: boolean;
  organizationId: string;
}

/**
 * Mobile-only bar holding the back link and the active settings page's
 * Save/Discard cluster. The desktop equivalent lives in the settings tab
 * strip (`SettingsNavigation`), which is `hidden md:block` — so on small
 * screens the Save/Discard buttons were unreachable. Reads the active editor
 * (set by each form page) and renders the cluster only when one is present.
 */
function SettingsMobileActionBar({
  showBack,
  isUserScope,
  organizationId,
}: SettingsMobileActionBarProps) {
  const { t: tCommon } = useT('common');
  const controller = useActiveEditor();

  if (!showBack && !controller) return null;

  return (
    <div className="border-border flex items-center justify-between gap-2 border-b px-4 py-2 md:hidden">
      {showBack ? (
        <Link
          to={
            isUserScope
              ? '/dashboard/$id/settings/personal'
              : '/dashboard/$id/settings'
          }
          params={{ id: organizationId }}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm font-medium"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {tCommon('actions.back')}
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      {controller && (
        <EditorActions controller={controller} entityKind="settings" />
      )}
    </div>
  );
}
