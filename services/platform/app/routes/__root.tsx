import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
} from '@tanstack/react-router';

import { SkipLink } from '@/app/components/layout/skip-link';
import { ThemeAssets } from '@/app/components/theme/theme-assets';
import { Toaster } from '@/app/components/ui/feedback/toaster';
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
      <SkipLink />
      <ThemeAssets />
      <FileEventsListener />
      <Outlet />
      <Toaster />
    </>
  );
}
