import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/lib/i18n/i18n';
import { I18nProvider } from '@/lib/i18n/i18n-provider';

import { router } from './router';

import './globals.css';

// TEMPORARY: marketing pages are pinned to light mode. Remove this comment and
// re-wrap the app in `<ThemeProvider>` (from `@tale/ui/theme`) once we ship a
// dark-mode design pass for /, /pricing, /hardware-pricing, /contact, and
// /request-demo. The platform UI keeps its own ThemeProvider — this lock only
// applies to the marketing site.
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>
  </StrictMode>,
);
