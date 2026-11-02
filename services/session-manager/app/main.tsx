import { AppShell } from '@tale/ui/app-shell';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { i18n } from '@/lib/i18n/i18n';

import { queryClient } from './lib/query-client';
import { installStaleBundleReload } from './lib/stale-bundle-reload';
import { router } from './router';

import './globals.css';
import './locals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// A tab that outlived an update of the manager reloads onto the new build when
// a navigation misses a chunk the update replaced.
installStaleBundleReload({ navigating: () => router.state.isLoading });

// `<AppShell>` enforces the standard `<ThemeProvider> → <LocaleProvider>
// → <I18nextProvider> → <LocaleSync>` stack every Tale frontend uses. The
// language is a preference of this browser, so the locale is detected on the
// client rather than taken from the URL.
const locale = { mode: 'client' } as const;
createRoot(root).render(
  <StrictMode>
    <AppShell i18n={i18n} locale={locale} theme>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppShell>
  </StrictMode>,
);
