import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { injectAcceptLanguage } from './vite-plugins/inject-accept-language';
import { injectEnv } from './vite-plugins/inject-env';
import { serveBrandingImages } from './vite-plugins/serve-branding-images';
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
  ],
});
