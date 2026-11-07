// Inter webfont, self-hosted via @fontsource. Imported here as a JS side-effect
// module — NOT via CSS `@import` in globals.css — on purpose:
//
// Tailwind v4's `@tailwindcss/postcss` inlines `@import`ed stylesheets but does
// NOT rebase their relative `url()` refs. Routing the @fontsource CSS through it
// (the old `@import '@fontsource/inter/400.css'` in globals.css) left the
// `url(./files/inter-*.woff2)` paths verbatim, so Vite never emitted the woff2
// assets and every font request 404'd to the SPA shell at runtime — masked only
// by the metric-matched 'Inter Fallback' (Arial) in globals.css.
//
// A JS import sends each stylesheet through Vite's own CSS-module pipeline, which
// resolves `url()` relative to the file's real location in node_modules and emits
// hashed, same-origin build assets (the same path KaTeX's fonts already take).
//
// app-shell.tsx imports this once, so every consumer (platform, docs, web) that
// mounts <AppShell> gets the real Inter without a per-app import. Keep the weights
// aligned with the usages across the monorepo.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
// @fontsource ships `font-display: swap`, and a webfont is only fetched once the
// browser lays out text that uses it — which here is *after* the JS bundle has
// parsed and React has painted. On a cold load the tab labels (and other chrome)
// therefore paint first in the metric-matched 'Inter Fallback' and visibly swap
// to Inter a beat later: a FOUT (see globals.css `Inter Fallback` — it fixes the
// metrics, not the glyph shapes, so the swap is still visible).
//
// Preloading the above-the-fold Latin subsets starts their download at app boot,
// in parallel with the JS bundle, so Inter is normally in the browser cache
// before the first paint and no fallback ever shows. We keep `swap` rather than
// `optional` so text always renders immediately (no invisible-text block) and so
// @fontsource stays the single source of truth for the @font-face set — the
// preload only reorders the fetch, it doesn't redefine the faces.
//
// Only the Latin subset (weights 400 body / 500 for `font-medium` chrome like the
// tab labels) is preloaded: every shipped UI locale is Latin, and non-Latin
// subsets (Cyrillic/Greek/…) stay lazily fetched on demand. `?url` yields the
// hashed, same-origin build asset; `crossorigin` (anonymous) must match the CORS
// mode @font-face fetches use, or the preload is discarded and the font
// re-downloads.
import interLatin400Url from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import interLatin500Url from '@fontsource/inter/files/inter-latin-500-normal.woff2?url';

if (typeof document !== 'undefined') {
  for (const href of [interLatin400Url, interLatin500Url]) {
    if (
      document.head.querySelector(`link[rel="preload"][href="${href}"]`) !==
      null
    ) {
      continue;
    }
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'font';
    link.type = 'font/woff2';
    link.href = href;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }
}
