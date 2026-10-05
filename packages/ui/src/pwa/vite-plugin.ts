// Shared `vite-plugin-pwa` wiring for Tale services. The platform and
// the docs site (and any future service that wants a PWA shell) use this
// helper instead of restating the workbox + manifest config inline.
//
// Required peer dep on the consumer side: `vite-plugin-pwa`. Listed as
// an optional peer here so build-only consumers don't pull it in.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Plugin } from 'vite';
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa';

import { installOfflineRecovery } from './offline-recovery';

// This callback is serialized into the worker, whose global is not Window.
declare const self: { registration: ServiceWorkerRegistration };

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
  /** App scope and start URL, relative to the manifest. Defaults to `./`. */
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
   * to `offline.html`, relative to the worker — services ship it in `public/`.
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
 *  - precache the offline shell, its recovery script, build identity and icons
 *    (apps are online-first; we don't precache application JS/CSS bundles)
 *  - cache static assets at runtime (images, fonts) with sensible TTLs
 *  - serve the offline shell on failed, timed-out or HTTP 5xx navigations
 */
export function createPwaPlugin(options: PwaPluginOptions): Plugin[] {
  const {
    name,
    shortName,
    description,
    startUrl = './',
    scope = './',
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
    offlineFallback = 'offline.html',
    projectDir,
  } = options;

  // Public icons come from `includeAssets` + manifest icons + the web
  // manifest, hashed by vite-plugin-pwa (`additionalManifestEntries`). The
  // glob includes the offline shell, recovery script and build identity:
  // globbing public files too would find the same files
  // un-hashed under `dist/assets/`, and a glob hit there rides
  // vite-plugin-pwa's `dontCacheBustURLsMatching: /^assets\//` with
  // `revision: null` — the same URL twice with two revisions, which
  // workbox-precaching refuses at install
  // (`add-to-cache-list-conflicting-entries`), so the service worker
  // activated with an EMPTY cache: no offline shell, while the client still
  // announced "ready to work offline" (2026-09-26 evaluation, G-05/G-01).
  // `scripts/check-sw-manifest.ts` in the platform build pins the built
  // manifest to unique, revisioned entries.
  const globPatterns = [offlineFallback, 'pwa-recovery.js', 'pwa-build.json'];
  // Keep direct offline.html navigations on the navigation strategy too:
  // Workbox's precache route otherwise returns canonical, unscoped HTML.
  const offlineCacheURL = `${offlineFallback}?__tale_offline=1`;
  let buildDirectory = resolve(projectDir, 'dist');

  const buildIdentity: Plugin = {
    name: 'tale-pwa-build-identity',
    apply: 'build',
    configResolved(config) {
      buildDirectory = resolve(config.root, config.build.outDir);
      // Preserve the document's runtime <base> in relocatable builds.
      // Otherwise vite-plugin-pwa turns './' into '/' and pins sw.js to
      // the origin root, bypassing deployments under BASE_PATH.
      if (config.base === './' || config.base === '')
        pwaConfig.buildBase = './';
    },
    generateBundle(_output, bundle) {
      this.emitFile({
        type: 'asset',
        fileName: 'pwa-recovery.js',
        source: `(${installOfflineRecovery.toString()})();`,
      });
      // A code-only release must change sw.js even though application bundles
      // are online-only. Deterministic output, without a wall-clock nonce.
      const hash = createHash('sha256');
      for (const bundleName of Object.keys(bundle).sort()) {
        const entry = bundle[bundleName];
        if (!entry) continue;
        hash.update(bundleName).update('\0');
        hash.update(entry.type === 'chunk' ? entry.code : entry.source);
      }
      this.emitFile({
        type: 'asset',
        fileName: 'pwa-build.json',
        source: JSON.stringify({
          revision: hash.digest('hex'),
          assets: Object.keys(bundle)
            .filter((bundleName) => bundleName.startsWith('assets/'))
            .sort(),
        }),
      });
    },
  };

  const pwaConfig: Partial<VitePWAOptions> = {
    scope,
    registerType: 'prompt',
    injectRegister: null,
    strategies: 'generateSW',
    workbox: {
      globPatterns,
      clientsClaim: true,
      inlineWorkboxRuntime: true,
      manifestTransforms: [
        async (entries) => ({
          manifest: await Promise.all(
            entries.map(async (entry) => {
              if (
                ![
                  offlineFallback,
                  'pwa-recovery.js',
                  'pwa-build.json',
                ].includes(entry.url)
              )
                return entry;
              // Revisions choose cache keys; integrity verifies the bytes.
              // During a rollout sw.js and these mutable URLs can come from
              // different colours. Refuse that install, keeping the old worker.
              const bytes = await readFile(resolve(buildDirectory, entry.url));
              const digest = createHash('sha256').update(bytes).digest();
              return {
                ...entry,
                url:
                  entry.url === offlineFallback ? offlineCacheURL : entry.url,
                revision: digest.toString('hex'),
                integrity: `sha256-${digest.toString('base64')}`,
              };
            }),
          ),
        }),
      ],
      // The three recovery files come from the glob and integrity transform.
      // Public includeAssets entries are added AFTER manifestTransforms,
      // so the offline shell must not also be in that unprotected list.
      // We still set `navigateFallback` because vite-plugin-pwa's dev mode
      // hard-codes its precache manifest to `[{ url: navigateFallback, ... }]`
      // and ignores any extra entries — pointing it at the offline shell
      // makes the dev SW behave like prod. The empty allowlist stops the
      // navigation route this option would otherwise register from ever
      // matching; navigations are handled by the runtimeCaching entry
      // below (`precacheFallback`), which also handles proxy HTTP failures.
      navigateFallback: offlineCacheURL,
      navigateFallbackAllowlist: [],
      runtimeCaching: [
        {
          // Navigations always hit the network so the live app shell renders.
          // Failed, timed-out and HTTP 5xx navigations use the cached shell.
          urlPattern: ({ request, url }) => {
            const workerScope = new URL(self.registration.scope);
            const path = '/' + url.pathname.slice(workerScope.pathname.length);
            return (
              request.mode === 'navigate' &&
              url.origin === workerScope.origin &&
              url.pathname.startsWith(workerScope.pathname) &&
              !/^\/(?:api|ws_api|http_api|events|dav|scim|sandbox|metrics|\.well-known)(?:\/|$)/.test(
                path,
              ) &&
              !/^\/status(?:\.json)?\/?$/.test(path)
            );
          },
          handler: 'NetworkOnly',
          options: {
            plugins: [
              {
                // generateSW rejects networkTimeoutSeconds on NetworkOnly,
                // despite the runtime supporting it. Abort the actual request
                // instead, with per-request state shared by these callbacks.
                requestWillFetch: async ({ request, state }) => {
                  const controller = new AbortController();
                  if (state)
                    state.navigationTimeout = setTimeout(
                      () => controller.abort(),
                      8_000,
                    );
                  return new Request(request, {
                    signal: controller.signal,
                    cache: 'no-store',
                  });
                },
                fetchDidFail: async ({ state }) => {
                  if (typeof state?.navigationTimeout === 'number')
                    clearTimeout(state.navigationTimeout);
                },
                fetchDidSucceed: async ({ response, state }) => {
                  // FRP and Cloudflare answer HTTP errors instead of rejecting
                  // fetch. Turn failed navigations into the same cached shell.
                  if (response.status >= 500) {
                    void response.body?.cancel();
                    throw new Error('Navigation unavailable');
                  }
                  // A proxy can send headers then stall the HTML body too.
                  // Keep the deadline until the complete document arrives.
                  try {
                    await response.clone().arrayBuffer();
                    // Preserve redirect/URL metadata on the network response.
                    return response;
                  } finally {
                    if (typeof state?.navigationTimeout === 'number')
                      clearTimeout(state.navigationTimeout);
                  }
                },
                handlerWillRespond: async ({ response }) => {
                  if (response.headers.get('X-Tale-PWA-Offline') !== '1')
                    return response;
                  // Precache fetches receive canonical bytes for integrity.
                  // Scope their script only when returning the offline screen.
                  const scriptPath = new URL(
                    'pwa-recovery.js',
                    self.registration.scope,
                  ).pathname;
                  const html = (await response.text()).replace(
                    'src="/pwa-recovery.js"',
                    () => `src="${scriptPath}"`,
                  );
                  const headers = new Headers(response.headers);
                  headers.delete('content-length');
                  headers.delete('content-encoding');
                  headers.delete('etag');
                  return new Response(html, {
                    status: response.status,
                    statusText: response.statusText,
                    headers,
                  });
                },
              },
            ],
            precacheFallback: { fallbackURL: offlineCacheURL },
          },
        },
        {
          urlPattern: /\/assets\/.*\.(?:png|jpg|jpeg|svg|webp|ico)$/i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'tale-assets',
            cacheableResponse: { statuses: [200] },
            expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
          },
        },
        {
          urlPattern: /\.(?:woff2?|ttf)$/i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'tale-fonts',
            cacheableResponse: { statuses: [200] },
            expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
          },
        },
        ...extraRuntimeCaching,
      ],
      cleanupOutdatedCaches: true,
    },
    includeAssets: includeAssets.filter((asset) => asset !== offlineFallback),
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
  };
  return [buildIdentity, ...VitePWA(pwaConfig)];
}
