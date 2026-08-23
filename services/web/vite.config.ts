import { artifactsPlugin } from '@tale/ui/seo/vite-plugin-artifacts';
import { yamlImports } from '@tale/ui/vite/yaml';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import type { Connect } from 'vite';
import { defineConfig, type PreviewServer, type ViteDevServer } from 'vite';

import {
  RELEASES,
  RELEASES_FETCHED_AT,
} from './app/generated/releases-manifest';
import { createReleaseFeed } from './lib/releases/feed';
import { handleReleasesRequest, RELEASES_ROUTE } from './lib/releases/route';
import { createMarketingArtifactsServer } from './lib/seo/artifacts-server';

/**
 * In production the web droplet's Caddy answers `/_a/*` — the first-party
 * analytics proxy the tag in index.html loads from. Vite's dev and preview
 * servers have no such upstream, so the script request would 404 into the
 * browser console and fail the smoke suite's no-console-errors guard. Serve
 * a no-op stub on exactly that path instead. The BUILT artifact carries no
 * stub, so a misconfigured droplet proxy still fails loudly in production.
 */
function stubAnalyticsScript(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use('/_a/script.js', (_req, res) => {
    res.setHeader('content-type', 'text/javascript');
    res.end(
      '/* analytics stub — production serves this via the Caddy proxy */',
    );
  });
}

// In dev the SSR loader is bound at the first artifact request via the
// inline plugin below. Cache is disabled so source edits show up
// immediately without a manual invalidate.
let viteSsrLoad: ((url: string) => Promise<{ html: string }>) | null = null;
const devArtifactsServer = createMarketingArtifactsServer({
  cache: false,
  ssr: {
    render: async (url) => {
      if (!viteSsrLoad) {
        throw new Error('Vite SSR loader not initialised');
      }
      return viteSsrLoad(url);
    },
  },
});

// `/api/releases` is a `server.ts` route in production. Mirror it in dev and
// preview — through the same handler — so the changelog page exercises the real
// code path locally and under Playwright.
const devReleaseFeed = createReleaseFeed({
  snapshot: RELEASES,
  snapshotFetchedAt: RELEASES_FETCHED_AT,
});

function mountReleaseFeedRoute(middlewares: Connect.Server): void {
  middlewares.use(RELEASES_ROUTE, (request, nodeResponse) => {
    const response = handleReleasesRequest(
      new Request(`http://localhost${RELEASES_ROUTE}`, {
        method: request.method ?? 'GET',
      }),
      devReleaseFeed,
    );
    nodeResponse.statusCode = response.status;
    for (const [key, value] of response.headers) {
      nodeResponse.setHeader(key, value);
    }
    void response.text().then((text) => nodeResponse.end(text));
  });
}

export default defineConfig({
  // Absolute base so the SPA shell loads its assets correctly when served
  // as the fallback for nested URLs (e.g. /de/pricing) — relative './assets/'
  // resolves against the request path and 404s under any /<locale>/<route>.
  base: '/',
  resolve: {
    dedupe: ['react', 'react-dom'],
    tsconfigPaths: true,
  },
  server: {
    port: 3001,
    // Fail loudly on a taken port instead of silently serving the next one:
    // every consumer (the Playwright webServer probe, the prerender script)
    // targets 3001 by name, so a shifted port reads as "server never came up".
    strictPort: true,
  },
  optimizeDeps: {
    // Discovery stays ON: the marketing pages pull CJS-only transitives through
    // react-markdown (`void-elements`, …) that only get their default-export
    // interop from a prebundle, and `noDiscovery` breaks every page that
    // renders markdown. Keep the explicit list as a warm-start hint only.
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      '@tanstack/react-router',
      '@tanstack/react-query',
      'lucide-react',
      'framer-motion',
      'zod',
    ],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
  ssr: {
    noExternal: [
      '@tale/ui',
      '@tanstack/react-router',
      'framer-motion',
      'lucide-react',
      'react-i18next',
      'i18next',
      'i18next-icu',
    ],
  },
  plugins: [
    yamlImports(),
    tanstackRouter({ autoCodeSplitting: true }),
    viteReact(),
    {
      // Binds the dev SSR loader the first time the artifacts plugin
      // needs it. Runs only in dev (`apply: 'serve'`).
      name: 'tale-web:bind-ssr-loader',
      apply: 'serve',
      configureServer(server) {
        viteSsrLoad = async (url) => {
          const mod = (await server.ssrLoadModule('/app/entry-server.tsx')) as {
            render: (url: string) => Promise<{ html: string }>;
          };
          return mod.render(url);
        };
      },
    },
    {
      name: 'tale-web:release-feed',
      configureServer: (server) => mountReleaseFeedRoute(server.middlewares),
      configurePreviewServer: (server) =>
        mountReleaseFeedRoute(server.middlewares),
    },
    {
      name: 'tale-web:analytics-stub',
      configureServer: stubAnalyticsScript,
      configurePreviewServer: stubAnalyticsScript,
    },
    artifactsPlugin({ server: devArtifactsServer }),
  ],
});
