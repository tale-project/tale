import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { I18nProvider } from '@/lib/i18n/i18n-provider';
import '@/lib/i18n/i18n';
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
createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>
  </StrictMode>,
);
