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

// `<AppShell>` is mounted without `locale` because docs reads its locale
// from the URL — `__root.tsx` calls `<LocaleSync>` directly with
// `useCurrentLocale()`.
createRoot(root).render(
  <StrictMode>
    <AppShell i18n={i18n} theme>
      <RouterProvider router={router} />
    </AppShell>
  </StrictMode>,
);
