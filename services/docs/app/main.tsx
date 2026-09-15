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
    if (match?.status !== 'success' || match.globalNotFound) return undefined;
    if (match.routeId === '/') return '/';
    return match.loaderData?.analyticsPath;
  },
);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Intentionally `createRoot`, NOT `hydrateRoot`. The prerendered HTML
// (scripts/prerender.ts) still carries the full body + correct `<head>` for
// crawlers and instant first paint, but a doc page's body is fetched by an
// async route loader (`$.tsx` → `ensureDocBody`, a lazy dynamic import). On the
// client that body isn't in cache on the first synchronous render, so
// hydration would mismatch the SSR markup. createRoot adopts the URL + theme
// deterministically and re-renders to the identical final DOM. (Web is
// createRoot too — its non-Start TanStack Router Suspense markers don't
// rehydrate cleanly; see services/web/app/main.tsx.)
//
// The initial route load MUST finish before the first render. Rendering
// while the `$.tsx` loader is still awaiting its doc-body chunk makes
// React's first commit an empty match tree — it tears down the prerendered
// page into a blank frame (~100ms locally, a full chunk round-trip in
// production) before the real content commits: a visible flicker on every
// cold load. Awaiting `router.load()` first keeps the prerendered DOM
// painted until the whole final tree can commit in one pass. A load
// failure still renders — the router surfaces route errors itself.
//
// `<AppShell>` is mounted without `locale` because docs reads its locale
// from the URL — `__root.tsx` calls `<LocaleSync>` directly with
// `useCurrentLocale()`. `theme` keeps the canonical `'system'` default, the
// same as the design-system guide and the pre-paint script in `index.html`:
// a reader who never picked a theme follows the operating system, and the
// footer's switcher saves an explicit choice.
void router
  .load()
  .catch((error: unknown) => {
    console.error('[docs] initial route load failed', error);
    reportBrowserError(error);
  })
  .then(() => {
    createRoot(root, { onUncaughtError: reportBrowserError }).render(
      <StrictMode>
        <AppShell i18n={i18n} theme>
          <RouterProvider router={router} />
        </AppShell>
      </StrictMode>,
    );
  });
