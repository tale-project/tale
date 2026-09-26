import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@tale/ui/adaptive-header';
import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { ContentArea } from '@tale/ui/content-area';
import {
  ActiveEditorProvider,
  EditorActions,
  useActiveEditor,
} from '@tale/ui/editor';
import { MobileFloatingActions } from '@tale/ui/mobile-floating-actions';
import { PageLayout } from '@tale/ui/page-layout';
import { useIsMobile } from '@tale/ui/use-is-mobile';
import { Outlet, createFileRoute, useLocation } from '@tanstack/react-router';
import { useState } from 'react';

import { SettingsMobileBackButton } from '@/app/features/settings/components/settings-mobile-back-button';
import {
  SettingsRail,
  useSettingsPageTitle,
} from '@/app/features/settings/components/settings-rail';
import {
  SettingsHeaderActionsSetter,
  SettingsHeaderActionsReader,
  useSettingsHeaderActions,
  type SettingsHeaderAction,
} from '@/app/features/settings/components/settings-secondary-action-context';
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

  // The panel's header already names the section; the page header names the
  // open page (the index, which has none, keeps the section's name).
  const pageTitle = useSettingsPageTitle(organizationId);
  const headerTitle = pageTitle ?? tNav('userSettings');

  // Stable setter (from useState) goes in SetterContext so sub-page effects
  // can include it as a dep without causing re-render loops.
  const [headerActions, setHeaderActions] = useState<SettingsHeaderAction[]>(
    [],
  );

  const usesBoundedLayout =
    location.pathname.includes('/settings/governance') ||
    location.pathname.includes('/settings/metrics') ||
    location.pathname.includes('/settings/api') ||
    location.pathname.includes('/settings/branding');

  return (
    <ActiveEditorProvider>
      {/* Split provider: setter is stable, reader changes only when actions change. */}
      <SettingsHeaderActionsSetter.Provider value={setHeaderActions}>
        <SettingsHeaderActionsReader.Provider value={headerActions}>
          {/* The same frame as Home: the Settings panel runs the full height
              beside the page, with its own header, and the page carries the
              open page's name and its Save/Discard in a header of its own. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-row">
            <SettingsRail organizationId={organizationId} />
            <PageLayout
              organizationId={organizationId}
              className="min-w-0 flex-1"
              header={
                <AdaptiveHeaderRoot
                  showBorder
                  standalone={false}
                  className="gap-1"
                >
                  <SettingsMobileBackButton organizationId={organizationId} />
                  <AdaptiveHeaderTitle>{headerTitle}</AdaptiveHeaderTitle>
                  <SettingsEditorActionsSlot />
                </AdaptiveHeaderRoot>
              }
            >
              <SettingsMobileActionBar />
              <ContentArea
                key={location.pathname}
                className={cn(
                  'animate-in fade-in-0 min-w-0 overflow-y-auto duration-200 motion-reduce:animate-none',
                  usesBoundedLayout ? 'min-h-0 flex-1' : 'flex-1',
                )}
                variant="page"
                gap={6}
              >
                <Outlet />
              </ContentArea>
            </PageLayout>
          </div>
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
 * Branding registers its leading [Reset] and Providers its [Refresh catalogs]
 * this way.
 * Desktop only — mobile uses `SettingsMobileActionBar` (single mount).
 */
function SettingsEditorActionsSlot() {
  const controller = useActiveEditor();
  const actions = useSettingsHeaderActions();
  const isMobile = useIsMobile();

  if (isMobile) return null;
  if (!controller && actions.length === 0) return null;

  const { leading, trailing } = splitByPlacement(actions);

  return (
    <div className="ml-auto flex items-center gap-2">
      {leading.map((action) => (
        <HeaderActionButton key={action.label} action={action} />
      ))}
      {controller && (
        <EditorActions controller={controller} entityKind="settings" />
      )}
      {trailing.map((action) => (
        <HeaderActionButton key={action.label} action={action} />
      ))}
    </div>
  );
}

/** Page actions render on the side of the Discard/Save cluster they declare;
 * `trailing` is the default, so an action that says nothing keeps its place. */
function splitByPlacement(actions: SettingsHeaderAction[]) {
  return {
    leading: actions.filter((action) => action.placement === 'leading'),
    trailing: actions.filter((action) => action.placement !== 'leading'),
  };
}

/**
 * Mobile-only floating dock — mirrors `SettingsEditorActionsSlot` for small
 * screens so Save/Discard no longer sit under the header and crowd the page.
 */
function SettingsMobileActionBar() {
  const controller = useActiveEditor();
  const actions = useSettingsHeaderActions();
  const isMobile = useIsMobile();

  if (!isMobile) return null;
  if (!controller && actions.length === 0) return null;

  const { leading, trailing } = splitByPlacement(actions);

  return (
    <MobileFloatingActions>
      {leading.map((action) => (
        <HeaderActionButton key={action.label} action={action} />
      ))}
      {controller && (
        <EditorActions controller={controller} entityKind="settings" />
      )}
      {trailing.map((action) => (
        <HeaderActionButton key={action.label} action={action} />
      ))}
    </MobileFloatingActions>
  );
}
