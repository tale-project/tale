import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';
// ESM config to avoid CJS/ESM interop issues
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
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
            'convex/workflow_engine/helpers/validation/validate_predefined_workflows.test.ts',
          ],
        },
      },
      {
        extends: true,
        plugins: [
          storybookTest({ configDir: path.join(dirname, '.storybook') }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
          setupFiles: ['.storybook/vitest.setup.ts'],
        },
      },
    ],
  },
});
