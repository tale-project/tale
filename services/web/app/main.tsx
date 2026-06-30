import { AppShell } from '@tale/ui/app-shell';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { i18n } from '@/lib/i18n/i18n';

import { router } from './router';

import './globals.css';
import './locals.css';

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
createRoot(root).render(
  <StrictMode>
    <AppShell i18n={i18n} theme>
      <RouterProvider router={router} />
    </AppShell>
  </StrictMode>,
);
