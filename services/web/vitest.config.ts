import { yamlImports } from '@tale/ui/vite/yaml';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [viteReact(), yamlImports()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/*.test.{ts,tsx}'],
    // `tests/e2e/**` is Playwright's (`*.spec.ts`); keep Vitest out of it.
    // `tests/prerender/**` needs a built `dist/` — run via `test:prerender`.
    exclude: [
      'node_modules',
      'dist',
      'dist-ssr',
      '.storybook',
      'tests/e2e',
      'tests/prerender',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
    },
  },
});
