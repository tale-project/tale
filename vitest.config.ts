import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { yamlImports } from '@tale/ui/vite/yaml';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Component tests hold a jsdom + React heap each; the same worker window
// `@tale/ui` uses keeps CI's 2-core runner unchanged and bounds a wide dev
// machine.
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
