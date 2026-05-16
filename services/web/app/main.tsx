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

// TEMPORARY: marketing site is pinned to light mode until a dark-mode design
// pass ships. `ThemeProvider` is intentionally omitted so it cannot read
// `localStorage` or system preference and toggle the `.dark` class on
// `<html>` (which would re-activate every Tailwind `dark:` variant). Mirror
// any change here in `app/entry-server.tsx` and re-add `<ThemeProvider>`
// from `@tale/ui/theme` once dark styles exist.
//
// `<AppShell>` is mounted without `locale` because the marketing site reads
// its locale from the URL — `__root.tsx` calls `<LocaleSync>` directly with
// `useCurrentLocale()`.
createRoot(root).render(
  <StrictMode>
    <AppShell i18n={i18n}>
      <RouterProvider router={router} />
    </AppShell>
  </StrictMode>,
);
