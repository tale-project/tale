import { ThemeProvider } from '@tale/ui/theme';
import { Toaster } from '@tale/ui/toaster';
import { createRootRoute, createRoute } from '@tanstack/react-router';

import { AiAccessPage } from '@/app/features/settings/components/ai-access-page';
import { AppearancePage } from '@/app/features/settings/components/appearance-page';
import { GeneralPage } from '@/app/features/settings/components/general-page';
import { SettingsIndexPage } from '@/app/features/settings/components/settings-index-page';
import { SettingsLayout } from '@/app/features/settings/components/settings-layout';
import { openFirstPageOnDesktop } from '@/app/features/settings/lib/first-page';

import { PageFrame, renderRouter, standIn } from './route-page';
import { stubViewport, type Viewport } from './viewport';

/*
 * What a Settings test needs and the kit does not have: the section mounted
 * on a real router (so links navigate, the blocker blocks and `beforeLoad`
 * redirects), under the frame that gives the page a phone header, with a
 * toast viewport and the theme, and a viewport that is a phone or a computer.
 * The routes are the app's: the same components and the same `beforeLoad`.
 */

function createSettingsRoutes() {
  const root = createRootRoute({
    component: () => (
      <PageFrame>
        <Toaster />
      </PageFrame>
    ),
  });
  const settings = createRoute({
    getParentRoute: () => root,
    path: '/settings',
    component: SettingsLayout,
  });
  const children = [
    createRoute({
      getParentRoute: () => settings,
      path: '/',
      beforeLoad: () => openFirstPageOnDesktop(),
      component: SettingsIndexPage,
    }),
    createRoute({
      getParentRoute: () => settings,
      path: 'general',
      component: GeneralPage,
    }),
    createRoute({
      getParentRoute: () => settings,
      path: 'appearance',
      component: AppearancePage,
    }),
    createRoute({
      getParentRoute: () => settings,
      path: 'ai-access',
      component: AiAccessPage,
    }),
  ];
  // Anything else the test navigates to: the page a person leaves Settings for.
  return root.addChildren([
    settings.addChildren(children),
    standIn(root, '/sessions', 'Sessions page'),
  ]);
}

interface RenderSettingsOptions {
  /** Where the person is; Settings opens at `/settings`. */
  at?: string;
  viewport?: Viewport;
}

/** Mounts the Settings section on a router, at a page, on a phone or a computer. */
export function renderSettings({
  at = '/settings/general',
  viewport = 'desktop',
}: RenderSettingsOptions = {}) {
  const screenSize = stubViewport(viewport);
  const view = renderRouter(createSettingsRoutes(), at, (router) => (
    <ThemeProvider>{router}</ThemeProvider>
  ));
  return { ...view, resize: screenSize.resize };
}
