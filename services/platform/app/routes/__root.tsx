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
import { seo } from '@/lib/utils/seo';

export const Route = createRootRouteWithContext<RouterContext>()({
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
