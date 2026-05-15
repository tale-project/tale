import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
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
          environmentMatchGlobs: [['convex/**', 'edge-runtime']],
          server: { deps: { inline: ['convex-test'] } },
          include: ['**/*.test.{ts,tsx}'],
          exclude: [
            'node_modules',
            'dist',
            '**/*.config.{js,ts}',
            '**/.{idea,git,cache,output,temp}/**',
            'app/components/**/*.test.{ts,tsx}',
            'app/features/**/*.test.{ts,tsx}',
            'app/hooks/**/*.test.{ts,tsx}',
            '**/*.browser.test.{ts,tsx}',
            // PII tests run in their own project below — they need
            // `isolate: false` to amortize the pre-built scrubber across
            // 67k+ data-driven cases.
            'test/pii/**',
            'lib/pii/**/*.test.{ts,tsx}',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'pii',
          environment: 'node',
          include: ['test/pii/**/*.test.ts', 'lib/pii/**/*.test.ts'],
          // 67k+ data-driven cases — disable per-test isolation to
          // amortize the pre-built `Scrubber` across cases. The detector
          // is pure; tests do not share mutable state.
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'browser-e2e',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
          include: ['**/*.browser.test.{ts,tsx}'],
          exclude: ['node_modules', 'dist'],
        },
      },
      {
        extends: true,
        test: {
          name: 'client',
          environment: 'jsdom',
          setupFiles: ['./test/setup-ui.ts'],
          include: [
            'app/components/**/*.test.{ts,tsx}',
            'app/features/**/*.test.{ts,tsx}',
            'app/hooks/**/*.test.{ts,tsx}',
          ],
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
