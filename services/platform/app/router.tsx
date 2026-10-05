import * as Sentry from '@sentry/tanstackstart-react';
import { GlobalErrorDisplay } from '@tale/ui/error-boundaries/global-error-display';
import { QueryClient } from '@tanstack/react-query';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';

import { RouteNotFound } from '@/app/components/layout/route-not-found';
import { isStructuredBackendError } from '@/app/hooks/use-action-query';
import { warmSession } from '@/app/lib/auth/session-query';
import { installOrgErrorRecovery } from '@/app/lib/org-error-recovery';
import { markColdLoad } from '@/app/lib/perf/cold-load-trace';
import {
  BROWSER_EXTENSION_URLS,
  prepareSentryEvent,
} from '@/app/lib/sentry-normalize';
import { isStaleBundleFallout } from '@/app/lib/stale-bundle-recovery';
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
      // A healthy read keeps its stale window; a read that ERRORED on a
      // transport or server fault gets another chance when the tab is
      // looked at again, so a list that failed once does not sit on its
      // error until a navigation (2026-09-26 evaluation, G-07). A structured
      // refusal is deterministic and stays.
      refetchOnWindowFocus: (query) =>
        query.state.status === 'error' &&
        !isStructuredBackendError(query.state.error),
    },
  },
});

// Global stale-org recovery: any query erroring with AppError ORG_NOT_FOUND
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
  // Unmatched URLs render at the deepest matched route's outlet; this replaces
  // the bare unstyled "Not Found" with the platform 404 (heading + recovery
  // link): inside the shell for a dashboard-subtree miss, as a standalone page
  // anywhere else. The `/dashboard/$id/$` splat still wins for direct `$id`
  // children (it also sets a 404 title); this covers misses under nested
  // dashboard layouts that have no splat of their own, and outside the dashboard.
  defaultNotFoundComponent: RouteNotFound,
});

const sentryDsn = getEnv('SENTRY_DSN');
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: getEnv('SENTRY_ENVIRONMENT'),
    release: getEnv('TALE_VERSION'),
    integrations: [
      Sentry.tanstackRouterBrowserTracingIntegration(router),
      // Sentry captures thrown/unhandled errors by default but treats a plain
      // `console.error(...)` as a breadcrumb, not an issue. Promote error-level
      // console calls to issues so deliberately-logged failures are visible too.
      // Kept to `error` only (not `warn`) to bound event volume.
      Sentry.captureConsoleIntegration({ levels: ['error'] }),
    ],
    // A browser extension's error is not ours to fix: the SDK's own filter
    // drops an event whose innermost frame is an extension script, and
    // `prepareSentryEvent` applies the same list where it is tested.
    denyUrls: BROWSER_EXTENSION_URLS,
    // Drop what is no defect of ours: a cancelled request, whichever handler
    // caught it, an extension's error, an expected 4xx refusal, a transport
    // failure, and what a tab recovering from a deploy leaves behind of its
    // swallowed chunk loads (app/lib/stale-bundle-recovery.tsx). From the
    // rest, strip the per-call `[Request ID: …]` Convex failure text embeds,
    // which defeats message-based grouping, so events group by function +
    // root cause.
    beforeSend: (event, hint) =>
      isStaleBundleFallout() ? null : prepareSentryEvent(event, hint),
    tracesSampleRate: getEnv('SENTRY_TRACES_SAMPLE_RATE'),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }

  /** One-shot handoffs that must not land in the URL (see Auto assign → routing). */
  interface HistoryState {
    openRoutingRule?: boolean;
    routingAddress?: string;
    /** Where the thread arrived, as the routing editor's Arrives on names
     *  it: `mailbox:<credentialId>` or `api:<source>`. */
    routingArrivesOn?: string;
    returnToConversation?: {
      id: string;
      status: 'open' | 'closed' | 'spam' | 'archived';
    };
    /** How many `?task=` sheet entries the tasks board pushed above the bare
     *  board (see `features/tasks/lib/view.ts`). */
    taskSheetDepth?: number;
    /** Set on a rail click that resolved to a remembered deep link (see
     *  `use-navigation-items.ts`). Lets the landing route tell a restored
     *  arrival from a deliberate one, so a since-deleted automation or
     *  project falls back to its list instead of dead-ending. */
    navRestore?: boolean;
  }
}
