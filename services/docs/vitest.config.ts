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
          // `tests/e2e/**` is Playwright's (`*.spec.ts`); keep Vitest out of it.
          // `tests/prerender/**` needs a built `dist/` — run via `test:prerender`.
          exclude: [
            'node_modules',
            'dist',
            'tests/e2e/**',
            'tests/prerender/**',
          ],
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
        },
      },
    ],
  },
});
