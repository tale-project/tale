import { Button } from '@tale/ui/button';
import { Outlet, createFileRoute, useLocation } from '@tanstack/react-router';
import { useState } from 'react';

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
import {
  SettingsHeaderActionsSetter,
  SettingsHeaderActionsReader,
  useSettingsHeaderActions,
  type SettingsHeaderAction,
} from '@/app/features/settings/components/settings-secondary-action-context';
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

  // Stable setter (from useState) goes in SetterContext so sub-page effects
  // can include it as a dep without causing re-render loops.
  const [headerActions, setHeaderActions] = useState<SettingsHeaderAction[]>(
    [],
  );

  const usesBoundedLayout =
    location.pathname.includes('/settings/governance') ||
    location.pathname.includes('/settings/api') ||
    location.pathname.includes('/settings/branding') ||
    location.pathname.includes('/settings/deployment');

  return (
    <ActiveEditorProvider>
      {/* Split provider: setter is stable, reader changes only when actions change. */}
      <SettingsHeaderActionsSetter.Provider value={setHeaderActions}>
        <SettingsHeaderActionsReader.Provider value={headerActions}>
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
        </SettingsHeaderActionsReader.Provider>
      </SettingsHeaderActionsSetter.Provider>
    </ActiveEditorProvider>
  );
}

function HeaderActionButton({ action }: { action: SettingsHeaderAction }) {
  return (
    <Button
      variant={action.variant ?? 'primary'}
      size="sm"
      onClick={action.onClick}
      disabled={action.disabled}
      title={action.title}
    >
      {action.loading && action.loadingLabel
        ? action.loadingLabel
        : action.label}
    </Button>
  );
}

/**
 * Renders the unified Save/Discard cluster (from `useActiveEditor`) plus any
 * page-specific buttons registered via `useRegisterSettingsSecondaryAction`.
 * Data residency uses the latter exclusively: [Save] [Apply & restart].
 */
function SettingsEditorActionsSlot() {
  const controller = useActiveEditor();
  const actions = useSettingsHeaderActions();

  if (!controller && actions.length === 0) return null;

  return (
    <div className="ml-auto hidden items-center gap-2 md:flex">
      {controller && (
        <EditorActions controller={controller} entityKind="settings" />
      )}
      {actions.map((action) => (
        <HeaderActionButton key={action.label} action={action} />
      ))}
    </div>
  );
}

/**
 * Mobile-only bar — mirrors `SettingsEditorActionsSlot` for small screens.
 */
function SettingsMobileActionBar() {
  const controller = useActiveEditor();
  const actions = useSettingsHeaderActions();

  if (!controller && actions.length === 0) return null;

  return (
    <div className="border-border flex items-center justify-end gap-2 border-b px-4 py-2 md:hidden">
      {controller && (
        <EditorActions controller={controller} entityKind="settings" />
      )}
      {actions.map((action) => (
        <HeaderActionButton key={action.label} action={action} />
      ))}
    </div>
  );
}
