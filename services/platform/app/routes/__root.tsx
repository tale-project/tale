import { RouteProgressBar } from '@tale/ui/route-progress-bar';
import { ThemeAssets } from '@tale/ui/theme/assets';
import { Toaster } from '@tale/ui/toaster';
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
} from '@tanstack/react-router';

import { SkipLink } from '@/app/components/layout/skip-link';
import { useFileEvents } from '@/app/hooks/use-file-events';
import type { RouterContext } from '@/app/router';
import { sessionLocaleReady } from '@/lib/i18n/i18n';
import { seo } from '@/lib/utils/seo';

export const Route = createRootRouteWithContext<RouterContext>()({
  // The session's language is in place before the first frame and before any
  // head is resolved: German and French load on first use, and a title read
  // before them would stay English until the next navigation.
  loader: () => sessionLocaleReady(),
  head: () => ({
    meta: seo('default'),
  }),
  component: RootComponent,
});

function FileEventsListener() {
  useFileEvents();
  return null;
}

function RootComponent() {
  return (
    <>
      <HeadContent />
      <RouteProgressBar />
      <SkipLink />
      <ThemeAssets />
      <FileEventsListener />
      <Outlet />
      <Toaster />
    </>
  );
}
