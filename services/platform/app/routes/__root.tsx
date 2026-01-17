import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { ConvexProvider } from 'convex/react';
import { ThemeProvider } from '@/app/components/theme/theme-provider';
import { ThemeColorMeta } from '@/app/components/theme/theme-color-meta';
import { Toaster } from '@/app/components/ui/feedback/toaster';
import { ServiceWorkerManager } from '@/app/components/service-worker-manager';
import { OfflineProvider } from '@/app/components/offline-provider';
import { I18nProvider } from '@/lib/i18n/i18n-provider';
import type { RouterContext } from '@/app/router';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  const { queryClient, convex } = Route.useRouteContext();

  return (
    <I18nProvider>
      <ThemeProvider defaultTheme="system">
        <ThemeColorMeta />
        <ConvexProvider client={convex}>
          <QueryClientProvider client={queryClient}>
            <OfflineProvider>
              <Outlet />
            </OfflineProvider>
          </QueryClientProvider>
        </ConvexProvider>
        <ServiceWorkerManager />
        <Toaster />
      </ThemeProvider>
    </I18nProvider>
  );
}
