import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { yamlImports } from './src/vite/yaml';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Component tests hold a heavy jsdom + axe + React heap each, so the worker
// count is the memory/speed knob: a floor of 2 keeps CI's 2-core runner
// unchanged, the cap of 6 bounds peak heap on a wide dev machine.
const cpuCount = os.availableParallelism?.() ?? os.cpus().length;
const unitMaxWorkers = Math.max(2, Math.min(cpuCount - 1, 6));

export default defineConfig({
  plugins: [yamlImports(), react()],
  resolve: {
    alias: {
      // More-specific first: `@/tests/*` resolves to the package-root `tests/`
      // dir, while `@/*` continues to resolve to `src/*`. Vite matches aliases
      // in order, so this entry must precede `@`.
      '@/tests': fileURLToPath(new URL('./tests', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // jsdom logs "Not implemented: getComputedStyle … pseudo-elements" on
    // every axe pseudo-element probe; drop the known noise so the buffered
    // console output stays small. Inherited by every project via `extends`.
    onConsoleLog(log: string) {
      if (log.includes('Not implemented:')) return false;
      return undefined;
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          setupFiles: ['./tests/setup.ts'],
          globals: true,
          pool: 'threads',
          maxWorkers: unitMaxWorkers,
          include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
          // `*.browser.test.tsx` are real-Chromium component tests owned by
          // the `browser` project: they assert things jsdom fakes (layout,
          // focus trapping), so they must not run under jsdom.
          exclude: ['node_modules', 'dist', '**/*.browser.test.{ts,tsx}'],
          css: true,
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
          include: ['src/**/*.browser.test.{ts,tsx}'],
          exclude: ['node_modules', 'dist'],
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
