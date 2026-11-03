import { RouteProgressBar } from '@tale/ui/route-progress-bar';
import { ThemeAssets } from '@tale/ui/theme/assets';
import { Toaster } from '@tale/ui/toaster';
import { HeadContent, Outlet, createRootRoute } from '@tanstack/react-router';

import { AppFrame } from '@/app/components/layout/app-frame';
import { SkipLink } from '@/app/components/layout/skip-link';
import { ProxyFlowProvider } from '@/app/features/sessions/components/proxy-flow-provider';
import { useRetitleOnLanguageChange } from '@/app/hooks/use-retitle-on-language-change';
import { pageHead } from '@/app/lib/page-head';

export const Route = createRootRoute({
  head: () => pageHead(),
  component: RootComponent,
});

function RootComponent() {
  useRetitleOnLanguageChange();
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
