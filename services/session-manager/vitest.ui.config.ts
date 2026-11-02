import { yamlImports } from '@tale/ui/vite/yaml';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// `bun run test:ui`: the React components, in jsdom. The backend and the
// shared code are tested by `vitest.config.ts`, under Bun.
export default defineConfig({
  plugins: [viteReact(), yamlImports()],
  resolve: { tsconfigPaths: true },
  test: {
    name: 'ui',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // The page's tests, and those of the helpers they share (`tests/utils`).
    include: ['app/**/*.test.{ts,tsx}', 'tests/utils/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    // Many component tests end in an axe audit of a whole page; under a
    // parallel run that can outlast vitest's 5 s default without anything
    // being wrong.
    testTimeout: 15_000,
    // jsdom logs "Not implemented: getComputedStyle … pseudo-elements" on every
    // axe pseudo-element probe: drop the known noise so the output stays small.
    onConsoleLog(log: string) {
      if (log.includes('Not implemented:')) return false;
      return undefined;
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['app/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', 'app/routeTree.gen.ts', 'app/main.tsx'],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
    },
  },
});
