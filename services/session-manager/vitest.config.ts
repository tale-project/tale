import { yamlImports } from '@tale/ui/vite/yaml';
import { defineConfig } from 'vitest/config';

// `bun run test` runs this config under the Bun runtime (`bunx --bun vitest`):
// the backend is Bun code (`bun:sqlite`, `Bun.serve`), so its tests run where
// it ships. React components are tested by `vitest.ui.config.ts` (jsdom).
export default defineConfig({
  plugins: [yamlImports()],
  // `backend/contract.test.ts` drives the page's API client, which imports
  // with the page's `@/` alias.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    // Under the Bun runtime vitest would load zod as an external module and
    // lose its `z` export; inlining it keeps `import { z } from 'zod'` working.
    server: { deps: { inline: ['zod'] } },
    // `tests/e2e` holds the tests of the Playwright infrastructure (the ports
    // and settings of its servers, two servers in one process); its specs are
    // `*.spec.ts`, run by Playwright, and its launcher has no test of its own.
    // `tests/guards` holds the checks of how the service is put together
    // (which side imports what, which settings are documented).
    include: [
      'backend/**/*.test.ts',
      'lib/**/*.test.ts',
      'tests/e2e/*.test.ts',
      'tests/guards/*.test.ts',
    ],
    // Real sockets and servers: a loaded CI runner needs more than the 5 s default
    // (the UI project has the same budget for the same reason).
    testTimeout: 15_000,
    // The real-browser lane (`bun run test:camoufox`) is opt-in: it needs the
    // Camoufox browser (about 1.3 GB) and takes minutes.
    exclude: [
      'node_modules',
      'dist',
      'tests/e2e/specs',
      '**/*.camoufox.test.ts',
      '**/*.ui.test.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['backend/**/*.ts', 'lib/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        'backend/testing/**',
        'backend/main.ts',
        'lib/i18n/**',
      ],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
    },
  },
});
