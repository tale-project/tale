import { ThemeProvider } from '@tale/webui/theme';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/lib/i18n/i18n';
import { I18nProvider } from '@/lib/i18n/i18n-provider';

import { router } from './router';

import './globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('[docs] missing #root element');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light">
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
