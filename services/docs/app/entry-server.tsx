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
import { detectInitialLocale, resolveRegionalLocale } from '@/lib/i18n/locales';

import { routeTree } from './routeTree.gen';

interface RenderResult {
  html: string;
  /** Serialised per-route `<head>` captured during render (see HeadSink). */
  head: string;
}

const basepath =
  (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') || undefined;

export async function render(url: string): Promise<RenderResult> {
  // Align i18n with the request URL before render so OG alt + chrome strings
  // match the page locale (same contract as the marketing SSR entry).
  const pathname = new URL(url, 'http://placeholder.invalid').pathname;
  const pathForLocale = basepath
    ? pathname.replace(new RegExp(`^${basepath}`), '') || '/'
    : pathname;
  await i18n.changeLanguage(
    resolveRegionalLocale(detectInitialLocale(pathForLocale)),
  );

  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    basepath,
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  // Collect the route's `<head>` during render — `useDocumentMeta` writes
  // into the sink as the tree renders (effects don't run under
  // `renderToString`). Mirror any change here in `app/main.tsx`.
  const sink = createHeadSink();
  // `theme={{ defaultTheme: 'light' }}` matches the CSR path's pinned
  // light theme and keeps SSR/CSR hydration in sync. AppShell's default
  // `'system'` would otherwise resolve to dark for OS-dark crawlers
  // pre-hydration, leaking into the initial HTML's theme-color meta.
  // M9.
  const html = renderToString(
    <StrictMode>
      <HeadSinkContext.Provider value={sink}>
        <AppShell i18n={i18n} theme={{ defaultTheme: 'light' }}>
          <RouterProvider router={router} />
        </AppShell>
      </HeadSinkContext.Provider>
    </StrictMode>,
  );
  return { html, head: renderHeadToHtml(sink.tags) };
}
