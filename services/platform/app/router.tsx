import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { ConvexQueryClient } from '@convex-dev/react-query';
import * as Sentry from '@sentry/tanstackstart-react';
import { routeTree } from './routeTree.gen';
import { getEnv } from '@/lib/env';

export interface RouterContext {
  queryClient: QueryClient;
  convexQueryClient: ConvexQueryClient;
}

export function createRouter() {
  const siteUrl = getEnv('SITE_URL');
  const convexQueryClient = new ConvexQueryClient(`${siteUrl}/ws_api`);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
        staleTime: 5 * 60 * 1000,
      },
    },
  });

  convexQueryClient.connect(queryClient);

  const router = createTanStackRouter({
    routeTree,
    context: {
      queryClient,
      convexQueryClient,
    },
    defaultPreload: 'intent',
    scrollRestoration: true,
  });

  const sentryDsn = getEnv('SENTRY_DSN');
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
      tracesSampleRate: 1.0,
    });
  }

  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
