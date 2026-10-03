import { startBrowserAnalytics } from '@tale/ui/analytics/browser';
import { AppShell } from '@tale/ui/app-shell';
import {
  initBrowserMonitoring,
  reportBrowserError,
} from '@tale/ui/monitoring/browser';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { i18n } from '@/lib/i18n/i18n';

import { router } from './router';

import './globals.css';
import './locals.css';

initBrowserMonitoring();
startBrowserAnalytics(
  (resolved) => router.subscribe('onResolved', resolved),
  () => {
    const match = router.state.matches.at(-1);
    return match?.status === 'success' && !match.globalNotFound
      ? match.pathname
      : undefined;
  },
);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Intentionally `createRoot`, NOT `hydrateRoot`. The prerendered HTML
// (scripts/prerender.ts) carries the route's full body + exact `<head>` for
// crawlers and instant first paint, but this is a plain (non-Start) TanStack
// Router: it wraps the `<Outlet>` in a Suspense boundary whose SSR markers
// (`<!--$-->`) aren't dehydrated/rehydrated, so `hydrateRoot` reports a
// recoverable mismatch (React #418) and regenerates the tree anyway. createRoot
// adopts the URL + theme deterministically and renders the identical final DOM
// without the warning. (Docs is createRoot for the same family of reason —
// async route loaders; see services/docs/app/main.tsx.)
//
// `<AppShell>` is mounted without `locale` because the marketing site reads
// its locale from the URL — `__root.tsx` calls `<LocaleSync>` directly with
// `useCurrentLocale()`. Mirror any change here in `app/entry-server.tsx`.
// Keep the prerendered page in place until the route and its chunks are ready.
// Mounting an unresolved router first clears the document, clamps scrollY to
// zero, then grows it again — a visible jump if the reader has started scrolling.
// This is the same cold-load contract as docs and ui-docs.
async function loadInitialRoute() {
  await router.load();
  if (window.location.hash && window.scrollY > 0) {
    // The reader (or native fragment navigation) has already positioned the
    // prerendered page. Transitioner also handles hashes independently of
    // resetNextScroll, so suppress its duplicate initial anchor scroll.
    // Replace through the typed history API, then resolve that same location
    // before mounting. Future navigations set their own hash-scroll option.
    router.history.replace(router.history.location.href, {
      ...router.history.location.state,
      __hashScrollIntoViewOptions: false,
    });
    await router.load();
  }
}

void loadInitialRoute()
  .catch((error: unknown) => {
    console.error('[web] initial route load failed', error);
    reportBrowserError(error);
  })
  .then(() => {
    // The browser already positioned this prerendered document, and the reader
    // may have scrolled while chunks loaded. Consume only TanStack's initial
    // reset; subsequent navigation sets resetNextScroll normally.
    router.resetNextScroll = false;
    createRoot(root, { onUncaughtError: reportBrowserError }).render(
      <StrictMode>
        <AppShell i18n={i18n} theme>
          <RouterProvider router={router} />
        </AppShell>
      </StrictMode>,
    );
  });
