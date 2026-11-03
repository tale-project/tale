import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@tale/ui/adaptive-header';
import { ContentArea } from '@tale/ui/content-area';
import { ActiveEditorProvider, DirtyBlockerProvider } from '@tale/ui/editor';
import { PageLayout } from '@tale/ui/page-layout';
import { Outlet, useChildMatches } from '@tanstack/react-router';

import { useT } from '@/lib/i18n/client';

import {
  useSettingsPages,
  type SettingsPage,
} from '../hooks/use-settings-pages';
import { pageAt } from '../lib/pages';
import { SettingsBackButton } from './settings-back-button';
import {
  DockEditorActions,
  HeaderEditorActions,
} from './settings-editor-actions';
import { SettingsPanel } from './settings-panel';
import { SECTION_DIVIDER_CLASS } from './settings-section';

/**
 * The page the outlet shows. Not the location: that names the next page as soon
 * as a navigation starts, while the outlet keeps the current one until the next
 * has loaded, and the header must name what is on screen.
 */
function useShownPage(): SettingsPage | undefined {
  const pages = useSettingsPages();
  const pathname = useChildMatches({
    select: (matches) => matches.at(-1)?.pathname ?? '',
  });
  const key = pageAt(pathname)?.key;
  return pages.find((page) => page.key === key);
}

/**
 * The Settings section: its panel beside the page, and the page under a header
 * that names the open page (the panel already names the section) and carries
 * its Save and Discard.
 *
 * It mounts `DirtyBlockerProvider`, which the app does not mount above: the
 * start page is a draft, and leaving the page, by the panel, the rail or the
 * browser, must ask before it is lost. `ActiveEditorProvider` lets a page's
 * editor put its Save and Discard in the header.
 *
 * Mirrors the Settings route of the platform
 * (`routes/dashboard/$id/settings.tsx`): the same frame, header and dock.
 */
export function SettingsLayout() {
  const { t } = useT('navigation');
  const page = useShownPage();

  return (
    <DirtyBlockerProvider>
      <ActiveEditorProvider>
        <div className="flex min-h-0 min-w-0 flex-1 flex-row">
          <SettingsPanel />
          <PageLayout
            className="min-w-0 flex-1"
            header={
              <AdaptiveHeaderRoot
                showBorder
                standalone={false}
                className="gap-1"
              >
                {page !== undefined && <SettingsBackButton />}
                <AdaptiveHeaderTitle>
                  {page?.label ?? t('sections.settings')}
                </AdaptiveHeaderTitle>
                <HeaderEditorActions />
              </AdaptiveHeaderRoot>
            }
          >
            <DockEditorActions />
            {/* The sections of the page, a hairline between neighbours (the
                platform's `SettingsPage` does the same for its own). */}
            <ContentArea
              variant="narrow"
              gap={8}
              className={SECTION_DIVIDER_CLASS}
            >
              <Outlet />
            </ContentArea>
          </PageLayout>
        </div>
      </ActiveEditorProvider>
    </DirtyBlockerProvider>
  );
}
