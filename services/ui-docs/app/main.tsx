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
// Only a resolved, known page is a pageview: the home route reports itself and
// a documentation page reports the canonical path its loader derived. The 404
// route and the `.md` twins carry no loader data and are never counted.
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
// (scripts/prerender.ts) still carries the full body and the correct `<head>`
// for crawlers and instant first paint, but a page's body is fetched by an
// async route loader (`docs.$.tsx` → `ensureDocBody`, a lazy dynamic import).
// On the client that body isn't in cache on the first synchronous render, so
// hydration would mismatch the SSR markup. `createRoot` adopts the URL and
// theme deterministically and re-renders to the identical final DOM.
//
// The initial route load MUST finish before the first render: rendering while
// the loader is still awaiting its chunk makes React's first commit an empty
// match tree, tearing the prerendered page down into a blank frame before the
// real content commits.
//
// `<AppShell>` mounts without `locale` — the site is English-only, and
// `__root.tsx` pins `<LocaleSync locale="en" />` itself. `theme` is left at
// the canonical `'system'` default: the docs chrome ships both themes.
void router
  .load()
  .catch((error: unknown) => {
    console.error('[ui-docs] initial route load failed', error);
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
