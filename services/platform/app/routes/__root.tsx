import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { ThemeProvider } from '@/app/components/theme/theme-provider';
import { ThemeColorMeta } from '@/app/components/theme/theme-color-meta';
import { Toaster } from '@/app/components/ui/feedback/toaster';
import { ServiceWorkerManager } from '@/app/components/service-worker-manager';
import { OfflineProvider } from '@/app/components/offline-provider';
import { I18nProvider } from '@/lib/i18n/i18n-provider';
import { authClient } from '@/lib/auth-client';
import type { RouterContext } from '@/app/router';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  const { queryClient, convexQueryClient } = Route.useRouteContext();

  return (
    <ConvexBetterAuthProvider
      client={convexQueryClient.convexClient}
      authClient={authClient}
    >
      <I18nProvider>
        <ThemeProvider defaultTheme="system">
          <ThemeColorMeta />
          <QueryClientProvider client={queryClient}>
            <OfflineProvider>
              <Outlet />
            </OfflineProvider>
          </QueryClientProvider>
          <ServiceWorkerManager />
          <Toaster />
        </ThemeProvider>
      </I18nProvider>
    </ConvexBetterAuthProvider>
  );
}
