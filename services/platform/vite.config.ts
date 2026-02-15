import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import tsConfigPaths from 'vite-tsconfig-paths';

import { injectAcceptLanguage } from './vite-plugins/inject-accept-language';
import { injectEnv } from './vite-plugins/inject-env';
import { stubSSRImports } from './vite-plugins/stub-ssr';

export default defineConfig({
  resolve: {
    dedupe: ['convex', 'convex/react', 'react', 'react-dom'],
  },
  server: {
    port: 3000,
    proxy: {
      // Proxy Convex API requests to internal backend (matches Next.js rewrites)
      '/ws_api': {
        target: 'http://127.0.0.1:3210',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/ws_api/, ''),
      },
      '/http_api': {
        target: 'http://127.0.0.1:3211',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/http_api/, ''),
      },
      // Proxy all /api/* requests to Convex HTTP endpoint (auth, SSO, documents, workflows, etc.)
      '/api': {
        target: 'http://127.0.0.1:3211',
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
        },
      },
    },
  },
  plugins: [
    tanstackRouter(),
    injectEnv(),
    injectAcceptLanguage(),
    stubSSRImports(),
    tsConfigPaths(),
    viteReact(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'public',
      filename: 'sw.js',
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        injectionPoint: undefined,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
