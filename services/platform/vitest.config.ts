import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { yamlImports } from '@tale/ui/vite/yaml';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Every project inherits the root plugins via `extends: true`; the yaml
  // transform must run everywhere message catalogs are imported.
  plugins: [yamlImports()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          // Use node by default, but run tests under convex/** in edge-runtime per convex-test docs
          environment: 'node',
          // Most server tests boot a convex-test world (full-tree module
          // globs); under the fully parallel suite the 5s vitest default
          // starves whichever file lands on a saturated worker — the same
          // budget the chain/scim/slack suites size individually. 30s is a
          // per-TEST ceiling, not added wall-clock.
          testTimeout: 30_000,
          environmentMatchGlobs: [['convex/**', 'edge-runtime']],
          server: { deps: { inline: ['convex-test'] } },
          include: ['**/*.test.{ts,tsx}'],
          exclude: [
            'node_modules',
            'dist',
            // Playwright E2E suite — owned by playwright.config.ts.
            'tests/e2e/**',
            '**/*.config.{js,ts}',
            '**/.{idea,git,cache,output,temp}/**',
            'app/components/**/*.test.{ts,tsx}',
            'app/features/**/*.test.{ts,tsx}',
            'app/hooks/**/*.test.{ts,tsx}',
            '**/*.browser.test.{ts,tsx}',
            // PII suites run in the dedicated `pii` project below — they
            // need `isolate: false` to amortize the pre-built scrubbers
            // across the 67k-case fixture corpus.
            'tests/pii/**',
            'lib/pii/**/*.test.{ts,tsx}',
            // Bun container/integration suites (`*-test.ts`) are run directly
            // via `bun tests/integration/<name>.ts`, never by vitest.
            'tests/integration/**',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'pii',
          environment: 'node',
          include: ['tests/pii/**/*.test.ts', 'lib/pii/**/*.test.ts'],
          // The data-driven suite fans out to 67k+ cases — per-test
          // isolation would rebuild the shared scrubbers constantly. The
          // engine is pure; tests share no mutable state.
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          // Component-in-browser tests. Named `browser` (not `browser-e2e`)
          // so "e2e" unambiguously means the Playwright suite in `e2e/`.
          name: 'browser',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
          include: ['**/*.browser.test.{ts,tsx}'],
          exclude: ['node_modules', 'dist', 'tests/e2e/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'client',
          environment: 'jsdom',
          setupFiles: ['./tests/setup-ui.ts'],
          include: [
            'app/components/**/*.test.{ts,tsx}',
            'app/features/**/*.test.{ts,tsx}',
            'app/hooks/**/*.test.{ts,tsx}',
          ],
          // `*.browser.test.tsx` belong to the `browser` project (real Chromium).
          exclude: ['node_modules', 'dist', '**/*.browser.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir: path.join(dirname, '.storybook'),
          }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
