import { yamlImports } from '@tale/ui/vite/yaml';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Two projects, like `services/docs`: the gateway's own code runs on the
// server and needs node builtins, while the panel's components need a DOM.
export default defineConfig({
  plugins: [viteReact(), yamlImports()],
  // The same `@/…` resolution the app is built with, so a test imports a
  // module by the path its callers use rather than by a relative one.
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['backend/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          include: ['app/**/*.test.{ts,tsx}', 'lib/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
