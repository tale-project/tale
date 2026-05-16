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
  const html = renderToString(
    <StrictMode>
      <AppShell i18n={i18n} theme={{ defaultTheme: 'light' }}>
        <RouterProvider router={router} />
      </AppShell>
    </StrictMode>,
  );
  return { html };
}
