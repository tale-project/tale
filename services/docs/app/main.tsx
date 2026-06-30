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
// (scripts/prerender.ts) still carries the full body + correct `<head>` for
// crawlers and instant first paint, but a doc page's body is fetched by an
// async route loader (`$.tsx` → `ensureDocBody`, a lazy dynamic import). On the
// client that body isn't in cache on the first synchronous render, so
// hydration would mismatch the SSR markup. createRoot adopts the URL + theme
// deterministically and re-renders to the identical final DOM. (Web is
// createRoot too — its non-Start TanStack Router Suspense markers don't
// rehydrate cleanly; see services/web/app/main.tsx.)
//
// `<AppShell>` is mounted without `locale` because docs reads its locale
// from the URL — `__root.tsx` calls `<LocaleSync>` directly with
// `useCurrentLocale()`.
// Pass `theme={{ defaultTheme: 'light' }}` to preserve pre-AppShell
// behavior. The prior `<ThemeProvider defaultTheme="light">` hard-pinned
// docs to light; AppShell's default of `'system'` would otherwise flip
// favicon + theme-color meta for OS-dark users via `ThemeAssetSync` in
// `__root.tsx`, even though the docs body has no `dark:` Tailwind
// classes. M9.
createRoot(root).render(
  <StrictMode>
    <AppShell i18n={i18n} theme={{ defaultTheme: 'light' }}>
      <RouterProvider router={router} />
    </AppShell>
  </StrictMode>,
);
