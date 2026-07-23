import { createPwaPlugin } from '@tale/ui/pwa/vite-plugin';
import { artifactsPlugin } from '@tale/ui/seo/vite-plugin-artifacts';
import { yamlImports } from '@tale/ui/vite/yaml';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { createDocsArtifactsServer } from './lib/seo/artifacts-server';

// Constructed synchronously at config load — the `docs/` walk is deferred to
// the first artifact request, so this never blocks Vite from starting its dev
// server (a top-level `await` here intermittently stalled CI's docs e2e past
// the Playwright webServer timeout). `cache: false` so source edits to `docs/`
// are picked up without a restart.
const devArtifactsServer = createDocsArtifactsServer({ cache: false });

export default defineConfig({
  // Build-time mount point. Defaults to '/' for root deployments. Set to a
  // sub-path with trailing slash like '/docs/' (e.g. tale.dev/docs) to serve
  // the docs app under that prefix — Vite then prefixes every asset URL
  // accordingly.
  base: process.env.DOCS_BASE_URL ?? '/',
  resolve: {
    dedupe: ['react', 'react-dom'],
    tsconfigPaths: true,
  },
  server: {
    port: 3002,
    fs: {
      // Markdown content lives at the workspace root (`/docs`), one level above
      // this service. Allow Vite to serve files from the parent directories so
      // `import.meta.glob('../../../../docs/**/*.md')` resolves during dev.
      allow: ['../..'],
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      '@tanstack/react-router',
      '@tanstack/react-query',
      'framer-motion',
      'lucide-react',
      'minisearch',
      'react-markdown',
      'rehype-katex',
      'rehype-raw',
      'remark-gfm',
      'remark-math',
      'zod',
    ],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    modulePreload: {
      // mermaid-vendor is ~700 KB gzipped and only used on doc pages that
      // include a `mermaid` code block. The wrapper component already calls
      // `import('mermaid')` lazily, but Rolldown adds the chunk to the entry
      // HTML's <link rel="modulepreload"> list anyway, forcing every cold
      // visit to download it. Strip it from the preload graph; the dynamic
      // import still resolves on demand when a diagram actually renders.
      resolveDependencies: (_filename, deps) =>
        deps.filter((d) => !d.includes('mermaid-vendor')),
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/@tanstack/react-router')) {
            return 'router-vendor';
          }
          if (id.includes('node_modules/@radix-ui/')) {
            return 'radix-vendor';
          }
          if (id.includes('node_modules/lucide-react/')) {
            // Without this lucide ships ~30 separate icon chunks; bundling
            // them into one keeps the modulepreload list short.
            return 'lucide-vendor';
          }
          if (
            id.includes('node_modules/react-markdown/') ||
            id.includes('node_modules/remark-gfm/') ||
            id.includes('node_modules/remark-github-blockquote-alert/')
          ) {
            return 'markdown-vendor';
          }
          if (
            id.includes('node_modules/i18next/') ||
            id.includes('node_modules/i18next-icu/') ||
            id.includes('node_modules/intl-messageformat/') ||
            id.includes('node_modules/react-i18next/')
          ) {
            return 'i18n-vendor';
          }
          if (id.includes('node_modules/mermaid/')) {
            return 'mermaid-vendor';
          }
          return undefined;
        },
      },
    },
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
      'react-markdown',
      'rehype-katex',
      'rehype-raw',
      'remark-gfm',
      'remark-math',
    ],
  },
  plugins: [
    yamlImports(),
    tanstackRouter(),
    viteReact(),
    artifactsPlugin({ server: devArtifactsServer }),
    createPwaPlugin({
      name: 'Tale Docs',
      shortName: 'Tale Docs',
      description:
        'Documentation for Tale, the self-hosted orchestration layer for AI agents.',
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
