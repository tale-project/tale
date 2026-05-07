import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  resolve: {
    dedupe: ['react', 'react-dom'],
    tsconfigPaths: true,
  },
  server: {
    port: 3002,
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      '@tanstack/react-router',
      'lucide-react',
      'minisearch',
      'react-markdown',
      'remark-gfm',
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
      'lucide-react',
      'react-i18next',
      'i18next',
      'i18next-icu',
      'react-markdown',
      'remark-gfm',
    ],
  },
  plugins: [tanstackRouter(), viteReact()],
});
