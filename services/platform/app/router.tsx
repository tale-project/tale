import * as Sentry from '@sentry/tanstackstart-react';
import { QueryClient } from '@tanstack/react-query';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';

import { GlobalErrorDisplay } from '@/app/components/error-boundaries/displays/global-error-display';
import { RouteNotFound } from '@/app/components/layout/route-not-found';
import { isStructuredBackendError } from '@/app/hooks/use-action-query';
import { warmSession } from '@/app/lib/auth/session-query';
import { installOrgErrorRecovery } from '@/app/lib/org-error-recovery';
import { markColdLoad } from '@/app/lib/perf/cold-load-trace';
import { normalizeConvexSentryEvent } from '@/app/lib/sentry-normalize';
import { getEnv } from '@/lib/env';

import { routeTree } from './routeTree.gen';

export interface RouterContext {
  queryClient: QueryClient;
}

const basePath = getEnv('BASE_PATH');

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A structured error is deterministic — server-side validation, an
      // auth gate, an expected-state signal. Retrying just delays it
      // reaching the UI (and the recovery hook below); network errors still
      // retry the default 3 times. Same rationale as useActionQuery.
      retry: (failureCount, err) =>
        !isStructuredBackendError(err) && failureCount < 3,
      gcTime: 15 * 60 * 1000,
      // Reads are HTTP now: this bounds how often a remount refetches. The
      // `/events` hint stream invalidates whatever actually changed, so a
      // stale window never outlives a real change.
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

// Global stale-org recovery: any query erroring with BackendError ORG_NOT_FOUND
// means the active organization is gone (deleted org id persisted in the
// session, or an empty/garbage org context in a stale tab). Without this, such
// a session retries the same dead org-scoped queries on every visit, forever —
// clear the stale org and re-resolve through the picker instead. A cache
// subscription (not QueryCache onError) so live WS-pushed errors are seen too.
installOrgErrorRecovery(queryClient);

// Kick the Better Auth session fetch off at module load so the gate resolves
// against an in-flight request instead of starting one after mount (#2386).
warmSession();
markColdLoad('module-load');

export const router = createTanStackRouter({
  routeTree,
  basepath: basePath || '/',
  context: {
    queryClient,
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
    // Convex failure text embeds a per-call `[Request ID: …]`, which defeats
    // message-based grouping — every action failure opened its own issue.
    // Strip it so events group by function + root cause.
    beforeSend: (event) => normalizeConvexSentryEvent(event),
    tracesSampleRate: getEnv('SENTRY_TRACES_SAMPLE_RATE'),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
