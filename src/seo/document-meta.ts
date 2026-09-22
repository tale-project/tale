/**
 * Per-route `<head>` management. The page declares its meta once; this hook
 * is the single place that turns it into tags. The same resolved tags feed
 * two emitters (see `head-tags.ts`):
 *
 *   - **client** — applied to `document.head` in an effect as the user
 *     navigates the SPA.
 *   - **server** — captured into a {@link HeadSink} during `renderToString`
 *     (the prerenderer wraps the app in `<HeadSinkContext.Provider>`), then
 *     serialised into each route's prerendered `index.html`.
 *
 * Because both paths consume `resolveDocumentHead(meta)`, the prerendered
 * head is exactly the head the live page renders — no parallel list to drift.
 */

import { useContext, useEffect } from 'react';

import { HeadSinkContext } from './head-sink';
import {
  applyHeadToDocument,
  resolveDocumentHead,
  type DocumentHeadInput,
} from './head-tags';

type DocumentMeta = DocumentHeadInput;

export function useDocumentMeta(meta: DocumentMeta): void {
  const {
    title,
    description,
    canonicalPath,
    siteName = 'Tale',
    siteUrl,
    ogImage,
    defaultOgImage,
    ogImageAlt,
    ogImageWidth,
    ogImageHeight,
    ogImageType,
    ogLocale,
    ogLocaleAlternates,
    noindex,
    hreflang,
    jsonLd,
  } = meta;

  // SSR capture. Effects don't run under `renderToString`, so record the
  // resolved tags during render. On the client the provider is absent, so
  // `sink` is null here and only the effect below runs.
  const sink = useContext(HeadSinkContext);
  if (sink) {
    sink.tags = resolveDocumentHead(meta);
  }

  useEffect(() => {
    applyHeadToDocument(
      resolveDocumentHead({
        title,
        description,
        canonicalPath,
        siteName,
        siteUrl,
        ogImage,
        defaultOgImage,
        ogImageAlt,
        ogImageWidth,
        ogImageHeight,
        ogImageType,
        ogLocale,
        ogLocaleAlternates,
        noindex,
        hreflang,
        jsonLd,
      }),
    );
  }, [
    title,
    description,
    canonicalPath,
    siteName,
    siteUrl,
    ogImage,
    defaultOgImage,
    ogImageAlt,
    ogImageWidth,
    ogImageHeight,
    ogImageType,
    ogLocale,
    ogLocaleAlternates,
    noindex,
    hreflang,
    jsonLd,
  ]);
}

// Re-exported so the SSR entry points import the capture seam + serialiser
// from one place (`@tale/ui/seo/document-meta`).
export { HeadSinkContext, createHeadSink } from './head-sink';
export { renderHeadToHtml, resolveFullTitle } from './head-tags';
