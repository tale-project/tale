import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { yamlImports } from '@tale/ui/vite/yaml';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), yamlImports()],
  resolve: {
    alias: {
      '@': dirname,
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts', 'lib/**/*.test.ts'],
          // `tests/e2e/**` belongs to Playwright (`*.spec.ts`).
          exclude: ['node_modules', 'dist', 'tests/e2e/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          setupFiles: ['./tests/setup.ts'],
          globals: true,
          include: ['app/**/*.test.{ts,tsx}'],
          // Every chrome test ends in an axe audit of a full rail/strip
          // render; under a parallel turbo run that can outlast vitest's 5 s
          // default without anything being wrong.
          testTimeout: 15_000,
        },
      },
    ],
  },
});
