import { ConvexQueryClient } from '@convex-dev/react-query';
import * as Sentry from '@sentry/tanstackstart-react';
import { QueryClient } from '@tanstack/react-query';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';

import { GlobalErrorDisplay } from '@/app/components/error-boundaries/displays/global-error-display';
import { warmSession } from '@/app/lib/auth/session-query';
import { markColdLoad } from '@/app/lib/perf/cold-load-trace';
import { getEnv } from '@/lib/env';

import { routeTree } from './routeTree.gen';

export interface RouterContext {
  queryClient: QueryClient;
  convexQueryClient: ConvexQueryClient;
}

const siteUrl = getEnv('SITE_URL');
const basePath = getEnv('BASE_PATH');

export const convexQueryClient = new ConvexQueryClient(
  `${siteUrl}${basePath}/ws_api`,
);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryKeyHashFn: convexQueryClient.hashFn(),
      queryFn: convexQueryClient.queryFn(),
      // 15min: bounds stale Convex subscription leak when components unmount
      // (the @convex-dev/react-query integration ties WS subscription teardown
      // to React Query's cache 'removed' event, which fires only after gcTime
      // expires with zero observers). Aligned with the codebase's 5min staleTime
      // and TanStack defaults.
      gcTime: 15 * 60 * 1000,
    },
  },
});

convexQueryClient.connect(queryClient);

// Kick off the Better Auth session fetch at module load so the auth provider's
// session (and the Convex token fetch it gates on, which authenticates the
// websocket) resolves sooner — shrinking the cold-load auth handshake.
warmSession();
markColdLoad('module-load');

export const router = createTanStackRouter({
  routeTree,
  basepath: basePath || '/',
  context: {
    queryClient,
    convexQueryClient,
  },
  defaultPreload: 'intent',
  defaultPreloadDelay: 10,
  defaultPreloadGcTime: 3 * 60 * 1000,
  defaultPreloadStaleTime: 10 * 1000,
  scrollRestoration: true,
  defaultErrorComponent: ({ error, reset }) => (
    <GlobalErrorDisplay error={error} reset={reset} />
  ),
});

const sentryDsn = getEnv('SENTRY_DSN');
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    release: getEnv('TALE_VERSION'),
    integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
    tracesSampleRate: getEnv('SENTRY_TRACES_SAMPLE_RATE'),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
