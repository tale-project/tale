import { ConvexQueryClient } from '@convex-dev/react-query';
import * as Sentry from '@sentry/tanstackstart-react';
import { QueryClient } from '@tanstack/react-query';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';

import { GlobalErrorDisplay } from '@/app/components/error-boundaries/displays/global-error-display';
import { RouteNotFound } from '@/app/components/layout/route-not-found';
import { warmSession } from '@/app/lib/auth/session-query';
import { markColdLoad } from '@/app/lib/perf/cold-load-trace';
import { convexConsoleBeforeSend } from '@/app/lib/sentry/convex-console-events';
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
      // Convex keeps subscribed queries live over the WS (setQueryData on each
      // update) regardless of staleTime, so this only suppresses redundant
      // one-shot refetches on mount/focus — it never serves stale Convex data.
      // useActionQuery overrides to Infinity; the session query sets its own.
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

convexQueryClient.connect(queryClient);

// Kick off the Better Auth session fetch AND the Convex token mint at module
// load, in parallel — the auth provider then resolves both against in-flight
// requests instead of running them serially after mount, shrinking the
// cold-load auth handshake that blocks every auth-gated query (epic #2386).
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
  // Unmatched URLs render at the deepest matched route's outlet; this routes a
  // dashboard-subtree miss to the styled 404 (heading + recovery link, shell
  // intact) instead of the bare unstyled "Not Found". The `/dashboard/$id/$`
  // splat still wins for direct `$id` children (it also sets a 404 title); this
  // covers misses under nested dashboard layouts that have no splat of their own.
  defaultNotFoundComponent: RouteNotFound,
});

const sentryDsn = getEnv('SENTRY_DSN');
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    release: getEnv('TALE_VERSION'),
    integrations: [
      Sentry.tanstackRouterBrowserTracingIntegration(router),
      // Sentry captures thrown/unhandled errors by default but treats a plain
      // `console.error(...)` as a breadcrumb, not an issue. Promote error-level
      // console calls to issues so deliberately-logged failures are visible too.
      // Kept to `error` only (not `warn`) to bound event volume.
      Sentry.captureConsoleIntegration({ levels: ['error'] }),
    ],
    // convex/react embeds a unique `[Request ID: …]` in every failure it
    // logs, so without normalization each recurrence of the SAME failure
    // becomes a brand-new issue and buries real regressions (#3020).
    beforeSend: convexConsoleBeforeSend,
    tracesSampleRate: getEnv('SENTRY_TRACES_SAMPLE_RATE'),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
