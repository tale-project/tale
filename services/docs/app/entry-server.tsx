import { AppShell } from '@tale/ui/app-shell';
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';

import { i18n } from '@/lib/i18n/i18n';

import { routeTree } from './routeTree.gen';

interface RenderResult {
  html: string;
}

const basepath =
  (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') || undefined;

export async function render(url: string): Promise<RenderResult> {
  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    basepath,
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  // `theme={{ defaultTheme: 'light' }}` matches the CSR path's pinned
  // light theme and keeps SSR/CSR hydration in sync. AppShell's default
  // `'system'` would otherwise resolve to dark for OS-dark crawlers
  // pre-hydration, leaking into the initial HTML's theme-color meta.
  // M9.
  const html = renderToString(
    <StrictMode>
      <AppShell i18n={i18n} theme={{ defaultTheme: 'light' }}>
        <RouterProvider router={router} />
      </AppShell>
    </StrictMode>,
  );
  return { html };
}
