import { AppShell } from '@tale/ui/app-shell';
import {
  createHeadSink,
  HeadSinkContext,
  renderHeadToHtml,
} from '@tale/ui/seo/document-meta';
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
  /** Serialised per-route `<head>` captured during render (see HeadSink). */
  head: string;
}

const basepath =
  (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') || undefined;

export async function render(url: string): Promise<RenderResult> {
  // English-only site: pin the language before render so the chrome strings
  // and the OG alt text match what the browser will show.
  await i18n.changeLanguage('en');

  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    basepath,
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  // Collect the route's `<head>` during render — `useDocumentMeta` writes into
  // the sink as the tree renders (effects don't run under `renderToString`).
  // Mirror any change here in `app/main.tsx`.
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
