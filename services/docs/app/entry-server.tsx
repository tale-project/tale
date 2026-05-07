import { ThemeProvider } from '@tale/webui/theme';
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';

import '@/lib/i18n/i18n';
import { I18nProvider } from '@/lib/i18n/i18n-provider';

import { routeTree } from './routeTree.gen';

interface RenderResult {
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
      <ThemeProvider defaultTheme="light">
        <I18nProvider>
          <RouterProvider router={router} />
        </I18nProvider>
      </ThemeProvider>
    </StrictMode>,
  );
  return { html };
}
