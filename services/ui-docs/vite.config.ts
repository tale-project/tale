import { artifactsPlugin } from '@tale/ui/seo/vite-plugin-artifacts';
import { yamlImports } from '@tale/ui/vite/yaml';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { createUiDocsArtifactsServer } from './lib/seo/artifacts-server';

// Built synchronously at config load; the `content/` walk is deferred to the
// first artifact request so Vite's dev server never blocks on it.
// `cache: false` picks up markdown edits without a restart.
const devArtifactsServer = createUiDocsArtifactsServer({ cache: false });

export default defineConfig({
  // Build-time mount point. `/` for the root deployment at ui.tale.dev; set
  // `UI_DOCS_BASE_URL` to a sub-path with a trailing slash to mount elsewhere.
  base: process.env.UI_DOCS_BASE_URL ?? '/',
  resolve: {
    dedupe: ['react', 'react-dom'],
    tsconfigPaths: true,
  },
  server: {
    port: Number(process.env.UI_DOCS_PORT ?? 3003),
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      '@tanstack/react-router',
      'framer-motion',
      'lucide-react',
      'minisearch',
      'react-markdown',
      'rehype-katex',
      'rehype-raw',
      'remark-gfm',
      'remark-math',
    ],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    modulePreload: {
      // mermaid is only pulled in by a markdown page that renders a diagram;
      // the wrapper imports it lazily, so keep it out of the entry preload
      // graph (same reason as the docs site).
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
          if (id.includes('node_modules/@radix-ui/')) return 'radix-vendor';
          if (id.includes('node_modules/lucide-react/')) return 'lucide-vendor';
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
          if (id.includes('node_modules/mermaid/')) return 'mermaid-vendor';
          return undefined;
        },
      },
    },
  },
  ssr: {
    noExternal: [
      '@tale/marketing-ui',
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
  ],
});
