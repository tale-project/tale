import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';

import '@/lib/i18n/i18n';
import { i18n } from '@/lib/i18n/i18n';
import { I18nProvider } from '@/lib/i18n/i18n-provider';
import { detectInitialLocale, resolveRegionalLocale } from '@/lib/i18n/locales';

import { routeTree } from './routeTree.gen';

export interface RenderResult {
  html: string;
}

export async function render(url: string): Promise<RenderResult> {
  // Pull the locale out of the request URL and align i18n with it before
  // rendering. The shared singleton is fine for the marketing site's
  // request volume; switch to a per-request instance if SSR concurrency
  // ever becomes a real concern.
  const pathname = new URL(url, 'http://placeholder.invalid').pathname;
  await i18n.changeLanguage(
    resolveRegionalLocale(detectInitialLocale(pathname)),
  );

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
