// Shared `vite-plugin-pwa` wiring for Tale services. The platform and
// the docs site (and any future service that wants a PWA shell) use this
// helper instead of restating the workbox + manifest config inline.
//
// Required peer dep on the consumer side: `vite-plugin-pwa`. Listed as
// an optional peer here so build-only consumers don't pull it in.

import { resolve } from 'node:path';

import type { Plugin } from 'vite';
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa';

export interface PwaIconSpec {
  src: string;
  sizes: string;
  type?: string;
  purpose?: 'any' | 'maskable' | 'monochrome';
}

export interface PwaPluginOptions {
  /** Display name and short_name for the web app manifest. */
  name: string;
  shortName: string;
  description: string;
  /** App scope and start URL. Defaults to `/`. */
  startUrl?: string;
  scope?: string;
  /** Manifest theme colors. */
  themeColor: string;
  backgroundColor: string;
  /** Manifest icons (PNG/SVG). */
  icons: PwaIconSpec[];
  /**
   * Extra assets to include in the precache (relative to the build
   * `outDir`). Defaults to the offline shell + standard PWA icons.
   */
  includeAssets?: string[];
  /**
   * Extra workbox runtime caching rules. The default rules cache
   * static assets (images, fonts) under same-origin requests; pass
   * additional rules to extend behaviour.
   */
  extraRuntimeCaching?: VitePWAOptions['workbox']['runtimeCaching'];
  /**
   * Path to the offline shell HTML inside the build output. Defaults
   * to `/offline.html` — services must ship that file in `public/`.
   */
  offlineFallback?: string;
  /**
   * Project root directory; used to namespace the dev-mode temp dir
   * away from `dev-dist/` and into `dist-pwa/`. Pass `import.meta.dirname`.
   */
  projectDir: string;
}

/**
 * Build a `vite-plugin-pwa` plugin instance with Tale defaults:
 *  - prompt-on-update strategy (the app shows an in-product reload toast)
 *  - generate the service worker via workbox
 *  - precache only the offline shell + icons (apps are online-first;
 *    we don't precache JS/CSS bundles)
 *  - cache static assets at runtime (images, fonts) with sensible TTLs
 *  - serve `/offline.html` only when navigation truly fails
 */
export function createPwaPlugin(options: PwaPluginOptions): Plugin[] {
  const {
    name,
    shortName,
    description,
    startUrl = '/',
    scope = '/',
    themeColor,
    backgroundColor,
    icons,
    includeAssets = [
      'favicon.ico',
      'favicon-light.png',
      'favicon-dark.png',
      'offline.html',
      'assets/apple-touch-icon-180x180.png',
    ],
    extraRuntimeCaching = [],
    offlineFallback = '/offline.html',
    projectDir,
  } = options;

  return VitePWA({
    registerType: 'prompt',
    injectRegister: null,
    strategies: 'generateSW',
    workbox: {
      globPatterns: [
        '**/*.webmanifest',
        '**/*.svg',
        '**/*.ico',
        'favicon-*.png',
        'assets/pwa-*.png',
        'assets/apple-touch-*.png',
        'assets/maskable-*.png',
      ],
      // `offline.html` is precached via `includeAssets` (default list above)
      // with a content-based revision injected by vite-plugin-pwa, so
      // Workbox automatically refreshes the cache when the shell changes.
      // We still set `navigateFallback` because vite-plugin-pwa's dev mode
      // hard-codes its precache manifest to `[{ url: navigateFallback, ... }]`
      // and ignores any extra entries — pointing it at the offline shell
      // makes the dev SW behave like prod. The empty allowlist stops the
      // navigation route this option would otherwise register from ever
      // matching; navigations are handled by the runtimeCaching entry
      // below (`precacheFallback`), which only serves the shell on real
      // network failure.
      navigateFallback: offlineFallback,
      navigateFallbackAllowlist: [],
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
            precacheFallback: { fallbackURL: offlineFallback },
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
        ...extraRuntimeCaching,
      ],
      cleanupOutdatedCaches: true,
    },
    includeAssets,
    manifest: {
      name,
      short_name: shortName,
      description,
      start_url: startUrl,
      scope,
      display: 'standalone',
      background_color: backgroundColor,
      theme_color: themeColor,
      orientation: 'any',
      categories: ['business', 'productivity'],
      icons,
    },
    devOptions: {
      enabled: true,
      type: 'module',
      navigateFallbackAllowlist: [],
      resolveTempFolder: () => resolve(projectDir, 'dist-pwa'),
    },
  });
}
