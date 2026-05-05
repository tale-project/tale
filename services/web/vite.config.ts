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
      '@tanstack/react-router',
      'framer-motion',
      'lucide-react',
      'react-i18next',
      'i18next',
      'i18next-icu',
    ],
  },
  plugins: [tanstackRouter(), viteReact()],
});
