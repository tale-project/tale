import { resolve } from 'path';
import { defineConfig } from 'vite';
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
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  plugins: [
    stubSSRImports(),
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
