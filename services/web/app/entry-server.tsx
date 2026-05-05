import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';

import '@/lib/i18n/i18n';
import { I18nProvider } from '@/lib/i18n/i18n-provider';

import { routeTree } from './routeTree.gen';

// TEMPORARY: marketing pages are pinned to light mode. Mirror any change here
// in `app/main.tsx`. Re-add `<ThemeProvider>` from `@tale/ui/theme` once a
// dark-mode design pass lands for the marketing site.

export interface RenderResult {
  html: string;
}

export async function render(url: string): Promise<RenderResult> {
  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    history: createMemoryHistory({ initialEntries: [url] }),
  });

  await router.load();

  const html = renderToString(
    <StrictMode>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </StrictMode>,
  );

  return { html };
}
