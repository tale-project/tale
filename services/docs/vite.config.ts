import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Build-time mount point. Defaults to '/' (e.g. docs.tale.dev). Set to a
  // sub-path with trailing slash like '/docs/' to serve the docs app under
  // that prefix — Vite then prefixes every asset URL accordingly.
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
  plugins: [tanstackRouter(), viteReact()],
});
