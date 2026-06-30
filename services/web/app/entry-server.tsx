import { AppShell } from '@tale/ui/app-shell';
import {
  createHeadSink,
  HeadSinkContext,
  renderHeadToHtml,
} from '@tale/ui/seo/document-meta';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';

import { i18n } from '@/lib/i18n/i18n';
import { detectInitialLocale, resolveRegionalLocale } from '@/lib/i18n/locales';

import { routeTree } from './routeTree.gen';

export interface RenderResult {
  html: string;
  /** Serialised per-route `<head>` captured during render (see HeadSink). */
  head: string;
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

  // Collect the route's `<head>` as the tree renders — `useDocumentMeta`
  // writes into the sink during render (effects don't run under
  // `renderToString`). Mirror any change here in `app/main.tsx`.
  const sink = createHeadSink();

  const html = renderToString(
    <StrictMode>
      <HeadSinkContext.Provider value={sink}>
        <AppShell i18n={i18n} theme>
          <RouterProvider router={router} />
        </AppShell>
      </HeadSinkContext.Provider>
    </StrictMode>,
  );

  return { html, head: renderHeadToHtml(sink.tags) };
}
