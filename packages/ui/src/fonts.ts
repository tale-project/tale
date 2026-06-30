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
