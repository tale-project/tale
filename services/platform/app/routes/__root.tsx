import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
} from '@tanstack/react-router';

import type { RouterContext } from '@/app/router';

import { ThemeColorMeta } from '@/app/components/theme/theme-color-meta';
import { ThemeProvider } from '@/app/components/theme/theme-provider';
import { Toaster } from '@/app/components/ui/feedback/toaster';
import { authClient } from '@/lib/auth-client';
import { I18nProvider } from '@/lib/i18n/i18n-provider';
import { SiteUrlProvider } from '@/lib/site-url-context';
import { seo } from '@/lib/utils/seo';

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: seo('default'),
  }),
  component: RootComponent,
});

function RootComponent() {
  const { queryClient, convexQueryClient } = Route.useRouteContext();

  return (
    <SiteUrlProvider>
      <HeadContent />
      <ConvexBetterAuthProvider
        client={convexQueryClient.convexClient}
        authClient={authClient}
      >
        <I18nProvider>
          <ThemeProvider defaultTheme="system">
            <ThemeColorMeta />
            <QueryClientProvider client={queryClient}>
              <Outlet />
            </QueryClientProvider>
            <Toaster />
          </ThemeProvider>
        </I18nProvider>
      </ConvexBetterAuthProvider>
    </SiteUrlProvider>
  );
}
