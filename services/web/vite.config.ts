import { artifactsPlugin } from '@tale/seo/vite-plugin-artifacts';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { createMarketingArtifactsServer } from './lib/seo/artifacts-server';

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
  },
  optimizeDeps: {
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
      '@tale/webui',
      '@tanstack/react-router',
      'framer-motion',
      'lucide-react',
      'react-i18next',
      'i18next',
      'i18next-icu',
    ],
  },
  plugins: [
    tanstackRouter(),
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
    artifactsPlugin({ server: devArtifactsServer }),
  ],
});
