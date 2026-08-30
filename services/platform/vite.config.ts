import { createPwaPlugin } from '@tale/ui/pwa/vite-plugin';
import { yamlImports } from '@tale/ui/vite/yaml';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { injectAcceptLanguage } from './vite-plugins/inject-accept-language';
import { injectBootShellPlugin } from './vite-plugins/inject-boot-shell';
import { injectEnv } from './vite-plugins/inject-env';
import { serveBrandingImages } from './vite-plugins/serve-branding-images';
import { serveCanvasPreview } from './vite-plugins/serve-canvas-preview';
import { serveScreencast } from './vite-plugins/serve-screencast';
import { serveStatus } from './vite-plugins/serve-status';
import { stubSSRImports } from './vite-plugins/stub-ssr';
import { watchExamples } from './vite-plugins/watch-examples';

// The backend for the dev proxy. In a real deployment Caddy fronts these
// same paths; locally Vite stands in for it. Defaults to the api's own port
// so `bun dev` works with no extra configuration.
const BACKEND_BASE = process.env.TALE_BACKEND_URL || 'http://127.0.0.1:3005';

// Backend routing, shared by the dev server (`vite dev`) and the preview
// server (`vite preview`, used by the prod-build E2E mode — see
// scripts/dev.ts). `/dav` is here too: the protocol door lives on the api,
// and Vite's SPA catch-all would otherwise answer PROPFIND with index.html.
const backendProxy = {
  '/api': { target: BACKEND_BASE, changeOrigin: true },
  '/events': { target: BACKEND_BASE, changeOrigin: true },
  '/dav': { target: BACKEND_BASE, changeOrigin: true },
  '/scim': { target: BACKEND_BASE, changeOrigin: true },
};

export default defineConfig({
  base: './',
  resolve: {
    dedupe: ['convex', 'convex/react', 'react', 'react-dom'],
    tsconfigPaths: true,
  },
  server: {
    port: 3000,
    // Fail loudly if 3000 is taken instead of silently moving to the next free
    // port: SITE_URL, the Convex proxy, and the dev orchestrator all assume the
    // app is on 3000, so a silent port shift just looks like "localhost:3000 is
    // broken". The dev orchestrator passes --strictPort too; this keeps direct
    // `vite`/preview invocations consistent.
    strictPort: true,
    proxy: backendProxy,
  },
  // Preview server (`vite preview`) — the prod-build E2E serving path. Serves
  // the built `dist/` assets (no on-the-fly transpilation, the dev-mode CPU
  // hog that starved the Convex backend on CI) and proxies Convex the same way
  // the dev server does. Dev-only middleware routes (`__ENV__` injection,
  // branding images, canvas preview, status) are re-registered on the preview
  // server via each plugin's `configurePreviewServer` hook.
  preview: {
    port: 3000,
    strictPort: true,
    proxy: backendProxy,
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'convex/react',
      '@tanstack/react-router',
      '@tanstack/react-query',
      '@convex-dev/react-query',
      'lucide-react',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-popover',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-slot',
      'framer-motion',
      'zod',
      'lodash',
      'date-fns',
      // Markdown rendering stack. Every consumer (chat, skills, workflows,
      // changelog, workspace viewers, docs bodies) lives behind a code-split
      // route or a lazily-loaded dialog, so Vite's cold-start scanner never
      // reaches them. The first navigation that mounts a renderer then
      // discovers this whole cluster at once, forcing a "optimized
      // dependencies changed. reloading" re-bundle — which rewrites the hashed
      // chunk names and 404s any in-flight request for the old ones (zwitch,
      // unist-util-visit, etc.). Pre-bundling the four entry points pulls their
      // transitive deps (micromark-*, hast/mdast-util-*) into the first pass so
      // no mid-session re-optimization is ever triggered.
      'react-markdown',
      'remark-gfm',
      'remark-math',
      'rehype-katex',
      'rehype-raw',
      'rehype-sanitize',
      // Custom markdown plugins (@tale/ui) reach *past* react-markdown and
      // import these micromark/unist internals directly, so each becomes its
      // own optimized entry that the react-markdown pre-bundle above does not
      // cover. Discovered only when a markdown route mounts a plugin, they
      // re-bundle the shared micromark chunk mid-session and 404 the in-flight
      // `dev-*.js` request. Listing them keeps that chunk stable from cold start.
      'micromark-core-commonmark',
      'micromark-util-classify-character',
      'unist-util-visit',
      // Charting stack (analytics + project metrics) is behind lazy routes,
      // so the cold-start scanner never sees `recharts`. First chart mount
      // discovers it plus its transitive prop-types -> react-is, forcing a
      // re-optimization that 404s the in-flight `react-is-*.js` chunk.
      'recharts',
      // Three deps reached only through lazily-loaded components/dialogs, so
      // the cold-start scanner never sees them. The first mount of each
      // discovers it mid-session and triggers a re-optimization that 504s the
      // in-flight dynamic import (an "Outdated Optimize Dep"), crashing the
      // feature into its error boundary:
      //   - `diff`        -> diff views behind lazily-loaded dialogs
      //   - `elkjs`       -> the shared flow layout engine (lazy `elk.bundled.js`)
      //   - react-json-view -> the JSON input/viewer (workflow step config panel)
      // Pre-bundling them keeps the optimizer hash stable from cold start.
      'diff',
      'elkjs/lib/elk.bundled.js',
      '@microlink/react-json-view',
    ],
    exclude: [
      '@tanstack/react-start/server',
      '@tanstack/react-start-server',
      '@tanstack/start-server-core',
      '@tanstack/start-plugin-core',
    ],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Group React core + tightly coupled dependencies together to avoid circular deps
            if (
              id.includes('/react/') ||
              id.includes('react-dom') ||
              id.includes('react-is') ||
              id.includes('scheduler') ||
              id.includes('@tanstack') ||
              id.includes('convex')
            ) {
              return 'vendor-core';
            }
            if (id.includes('@radix-ui')) {
              return 'vendor-radix';
            }
            if (id.includes('xlsx')) {
              return 'vendor-xlsx';
            }
            if (id.includes('pdfjs-dist')) {
              return 'vendor-pdf';
            }
            if (id.includes('katex')) {
              return 'vendor-katex';
            }
            if (
              id.includes('codemirror') ||
              id.includes('@codemirror') ||
              id.includes('@lezer')
            ) {
              return 'vendor-codemirror';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (
              id.includes('libphonenumber-js') ||
              id.includes('validator/lib') ||
              id.includes('validator/es')
            ) {
              return 'vendor-pii';
            }
          }
          return undefined;
        },
      },
    },
  },
  plugins: [
    yamlImports(),
    tanstackRouter(),
    injectAcceptLanguage(),
    stubSSRImports(),
    viteReact(),
    watchExamples(),
    serveBrandingImages(),
    serveCanvasPreview(),
    serveStatus(),
    serveScreencast(),
    // Before injectEnv: its middlewares only patch `res.end`, and the patch
    // must be installed before injectEnv's preview SPA-fallback middleware
    // (below) writes the HTML response it intercepts.
    injectBootShellPlugin(),
    // After the route-serving plugins: its `configurePreviewServer` middleware
    // is the SPA-navigation fallback (serves index.html with __ENV__ injected),
    // so the specific route handlers above must register first. Its dev-time
    // `transformIndexHtml` hook is unaffected by array order (`order: 'pre'`).
    injectEnv(),
    createPwaPlugin({
      name: 'Tale',
      shortName: 'Tale',
      description: 'AI-powered customer support platform',
      themeColor: '#09090b',
      backgroundColor: '#fcfcfc',
      projectDir: import.meta.dirname,
      icons: [
        { src: 'assets/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
        { src: 'assets/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        {
          src: 'assets/pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: 'assets/maskable-icon-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    }),
  ],
});
