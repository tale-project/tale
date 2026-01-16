import { defineConfig } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';
import viteReact from '@vitejs/plugin-react';
import { stubSSRImports } from './vite-plugins/stub-ssr';

export default defineConfig({
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  plugins: [stubSSRImports(), tsConfigPaths(), viteReact()],
});
