import { defineConfig } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';
import viteReact from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { stubSSRImports } from './vite-plugins/stub-ssr';

export default defineConfig({
  server: {
    port: 3000,
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
            if (id.includes('codemirror') || id.includes('@codemirror') || id.includes('@lezer')) {
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
        enabled: true,
        type: 'module',
      },
    }),
  ],
});
