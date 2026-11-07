import { RouteProgressBar } from '@tale/ui/route-progress-bar';
import { ThemeAssets } from '@tale/ui/theme/assets';
import { Toaster } from '@tale/ui/toaster';
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
} from '@tanstack/react-router';

import { AppFrame } from '@/app/components/layout/app-frame';
import { SkipLink } from '@/app/components/layout/skip-link';
import { ProxyFlowProvider } from '@/app/features/sessions/components/proxy-flow-provider';
import { metaQuery } from '@/app/hooks/use-meta';
import { useOpeningDone } from '@/app/hooks/use-opening-done';
import { useRetitleOnLanguageChange } from '@/app/hooks/use-retitle-on-language-change';
import { pageHead } from '@/app/lib/page-head';
import { waitForRead } from '@/app/lib/route-read';
import type { RouterContext } from '@/app/router';

export const Route = createRootRouteWithContext<RouterContext>()({
  // The state of the app is in before the first frame: its counts tell a list
  // that has no rows from one whose rows are on their way, so an empty table
  // shows its empty state at once instead of masked rows that vanish a moment
  // later, and the browser's state says which notice stands above the page. One
  // small read that decides what renders, which the platform awaits too
  // (`services/platform/app/lib/loader-preload.ts`); later visits find it in
  // the cache. A read that fails is for the banner to tell, not the route, and
  // one that is slow is waited for only so long (`waitForRead`): the page
  // renders as it would have without the loader.
  loader: ({ context }) =>
    waitForRead(
      context.queryClient.ensureQueryData(metaQuery()),
      (error: unknown) => {
        console.warn('Failed to load the state of the app', error);
      },
    ),
  head: () => pageHead(),
  component: RootComponent,
});

function RootComponent() {
  useRetitleOnLanguageChange();
  useOpeningDone();
  return (
    <>
      <HeadContent />
      <RouteProgressBar />
      <SkipLink />
      <ThemeAssets />
      {/* Here, not on a page: what a person started goes on when they leave it. */}
      <ProxyFlowProvider>
        <AppFrame>
          <Outlet />
        </AppFrame>
      </ProxyFlowProvider>
      <Toaster />
    </>
  );
}
