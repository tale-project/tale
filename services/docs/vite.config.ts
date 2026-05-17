import { artifactsPlugin } from '@tale/seo/vite-plugin-artifacts';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { createDocsArtifactsServer } from './lib/seo/artifacts-server';

// Built once at config load; the underlying server caches walks unless
// `cache: false` is set. We disable caching in dev so source edits to
// `docs/` are picked up without a restart.
const devArtifactsServer = await createDocsArtifactsServer({ cache: false });

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
      'rehype-raw',
      'remark-gfm',
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
      '@tale/webui',
      '@tanstack/react-router',
      'framer-motion',
      'lucide-react',
      'react-i18next',
      'i18next',
      'i18next-icu',
      'react-markdown',
      'rehype-raw',
      'remark-gfm',
    ],
  },
  plugins: [
    tanstackRouter(),
    viteReact(),
    artifactsPlugin({ server: devArtifactsServer }),
  ],
});
