import os from 'node:os';

import { yamlImports } from '@tale/ui/vite/yaml';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Each test file holds a heavy jsdom + axe + React heap, so concurrency is the
// memory/speed knob for this suite. `threads` is deliberate: a single heavy
// file (e.g. the governance editors) can exceed a forked process's default
// old-space and crash that worker, whereas thread workers reuse a roomier
// shared heap.
//
// The worker count was pinned at 2 — right for CI's 2-core runner, but it left
// a multi-core dev machine running the full suite in ~5 min. Scale it to the
// host instead: floor of 2 keeps CI unchanged (2 cores ⇒ 2 workers), and the
// cap of 6 bounds peak heap so more cores speed the run up (~5 min → ~2 min on
// a 12-core box) without reintroducing the OOM an unbounded pool hit.
const cpuCount = os.availableParallelism?.() ?? os.cpus().length;
const uiMaxWorkers = Math.max(2, Math.min(cpuCount - 1, 6));

export default defineConfig({
  // The yaml transform matches the root vitest config — UI components import
  // the message catalogs (messages/*.yml) through the i18n layer.
  plugins: [react(), yamlImports()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    pool: 'threads',
    // (`maxWorkers` is top-level in Vitest 4; `poolOptions` was removed.)
    maxWorkers: uiMaxWorkers,
    // jsdom logs "Not implemented: getComputedStyle … pseudo-elements" on every
    // axe pseudo-element probe — thousands per run. Vitest buffers captured
    // console output, so dropping this known-noise keeps the buffer small.
    onConsoleLog(log) {
      if (log.includes('Not implemented:')) return false;
      return undefined;
    },
    setupFiles: ['./tests/setup-ui.ts'],
    include: [
      'app/components/**/*.test.{ts,tsx}',
      'app/features/**/*.test.{ts,tsx}',
      'app/hooks/**/*.test.{ts,tsx}',
      'app/routes/**/*.test.{ts,tsx}',
    ],
    // `*.browser.test.tsx` are real-Chromium component tests owned by the
    // `browser` vitest project (`test:browser`); they assert things jsdom fakes
    // (real layout/getBoundingClientRect, React Flow geometry, focus trapping),
    // so they must NOT run under this jsdom config even though the glob matches.
    exclude: [
      'node_modules',
      '.next',
      'dist',
      'convex/**',
      '**/*.browser.test.{ts,tsx}',
    ],
    deps: {
      optimizer: {
        web: {
          include: ['@exodus/bytes', 'html-encoding-sniffer'],
        },
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: ['components/ui/**/*.{ts,tsx}'],
      exclude: ['**/*.stories.{ts,tsx}', '**/*.test.{ts,tsx}', '**/index.ts'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    css: true,
  },
});
