import { resolve } from 'node:path';

import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { injectAcceptLanguage } from './vite-plugins/inject-accept-language';
import { injectEnv } from './vite-plugins/inject-env';
import { serveBrandingImages } from './vite-plugins/serve-branding-images';
import { serveCanvasPreview } from './vite-plugins/serve-canvas-preview';
import { serveStatus } from './vite-plugins/serve-status';
import { stubSSRImports } from './vite-plugins/stub-ssr';
import { watchExamples } from './vite-plugins/watch-examples';

// Convex service endpoints for dev proxy. Defaults to localhost so local
// developers running `bunx convex-local-backend` standalone just work; for
// compose-based dev (`docker compose up convex` + `bun run dev`) set
// CONVEX_URL=http://localhost:3210 in .env.local or similar.
const CONVEX_BASE = process.env.CONVEX_URL || 'http://127.0.0.1:3210';
// Site-proxy lives on a separate port (default 3211) on the same host.
const CONVEX_SITE_PROXY =
  process.env.CONVEX_SITE_PROXY_URL || CONVEX_BASE.replace(/:\d+$/, ':3211');

export default defineConfig({
  base: './',
  resolve: {
    dedupe: ['convex', 'convex/react', 'react', 'react-dom'],
    tsconfigPaths: true,
  },
  server: {
    port: 3000,
    proxy: {
      // Proxy Convex API requests to the (possibly remote) convex service.
      '/ws_api': {
        target: CONVEX_BASE,
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/ws_api/, ''),
      },
      '/http_api': {
        target: CONVEX_SITE_PROXY,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/http_api/, ''),
      },
      // Storage and internal action callbacks go to the Convex backend (3210)
      '/api/storage': {
        target: CONVEX_BASE,
        changeOrigin: true,
      },
      '/api/actions': {
        target: CONVEX_BASE,
        changeOrigin: true,
      },
      // All other /api/* requests to Convex HTTP endpoint (auth, SSO, documents, workflows, etc.)
      '/api': {
        target: CONVEX_SITE_PROXY,
        changeOrigin: true,
      },
    },
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
    tanstackRouter(),
    injectEnv(),
    injectAcceptLanguage(),
    stubSSRImports(),
    viteReact(),
    watchExamples(),
    serveBrandingImages(),
    serveCanvasPreview(),
    serveStatus(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      strategies: 'generateSW',
      workbox: {
        // Precache only the offline shell + minimal branding assets.
        // The platform is an online-required app, so JS/CSS bundles are
        // intentionally not precached — when offline, users see the shell.
        globPatterns: [
          '**/*.webmanifest',
          '**/*.svg',
          '**/*.ico',
          'favicon-*.png',
          'assets/pwa-*.png',
          'assets/apple-touch-*.png',
          'assets/maskable-*.png',
        ],
        // vite-plugin-pwa's dev mode hard-codes the precache manifest to
        // `[{ url: navigateFallback, ... }]` and ignores any
        // `additionalManifestEntries` passed in. So we set
        // `navigateFallback` purely as a vehicle to enrol /offline.html
        // into the dev precache. The empty allowlists below stop the
        // navigation route that this option would otherwise register from
        // ever matching — navigation requests are handled by the
        // `runtimeCaching` entry instead, which only serves the shell on
        // real network failure (precacheFallback below).
        navigateFallback: '/offline.html',
        navigateFallbackAllowlist: [],
        // Production-mode precache (workbox-build runs the full pipeline
        // and honours this list). Same revision can stay since the shell
        // is a tiny static page.
        additionalManifestEntries: [
          { url: '/offline.html', revision: 'offline-shell-v1' },
        ],
        runtimeCaching: [
          {
            // Navigations always hit the network so the live app shell renders.
            // Only when the request fails (true offline / cold launch with no
            // connection) do we serve the precached offline shell.
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' &&
              !url.pathname.startsWith('/ws_api/') &&
              !url.pathname.startsWith('/http_api/') &&
              !url.pathname.startsWith('/api/') &&
              url.pathname !== '/status',
            handler: 'NetworkOnly',
            options: {
              precacheFallback: { fallbackURL: '/offline.html' },
            },
          },
          {
            urlPattern: /\/assets\/.*\.(?:png|jpg|jpeg|svg|webp|ico)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tale-assets',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /\.(?:woff2?|ttf)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tale-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
        cleanupOutdatedCaches: true,
      },
      includeAssets: [
        'favicon.ico',
        'favicon-light.png',
        'favicon-dark.png',
        'offline.html',
        'assets/apple-touch-icon-180x180.png',
      ],
      manifest: {
        name: 'Tale',
        short_name: 'Tale',
        description: 'AI-powered customer support platform',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#fcfcfc',
        theme_color: '#09090b',
        orientation: 'any',
        categories: ['business', 'productivity'],
        icons: [
          {
            src: 'assets/pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
          },
          {
            src: 'assets/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
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
      },
      devOptions: {
        enabled: true,
        type: 'module',
        // Same empty allowlist as in `workbox` above — required separately
        // because the dev pipeline reads `devOptions.navigateFallbackAllowlist`,
        // not the workbox one (defaults to `[/^\/$/]` otherwise).
        navigateFallbackAllowlist: [],
        // Store the dev-mode service worker output in `dist-pwa/` instead
        // of the plugin's default `dev-dist/` — keeps the dev artefacts
        // under a name that makes their purpose obvious next to the
        // production `dist/`.
        resolveTempFolder: () => resolve(import.meta.dirname, 'dist-pwa'),
      },
    }),
  ],
});
