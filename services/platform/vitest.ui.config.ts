import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    pool: 'threads',
    // Cap concurrency: each test file holds a heavy jsdom + axe + React heap,
    // and worker threads share the process V8 old-space, so an unbounded pool
    // pushes the large UI suite toward "JS heap out of memory". (`maxWorkers`
    // is top-level in Vitest 4; `poolOptions` was removed.)
    maxWorkers: 2,
    // jsdom logs "Not implemented: getComputedStyle … pseudo-elements" on every
    // axe pseudo-element probe — thousands per run. Vitest buffers captured
    // console output, so dropping this known-noise keeps the buffer small.
    onConsoleLog(log) {
      if (log.includes('Not implemented:')) return false;
      return undefined;
    },
    setupFiles: ['./test/setup-ui.ts'],
    include: [
      'app/components/**/*.test.{ts,tsx}',
      'app/features/**/*.test.{ts,tsx}',
      'app/hooks/**/*.test.{ts,tsx}',
      'app/routes/**/*.test.{ts,tsx}',
    ],
    exclude: ['node_modules', '.next', 'dist', 'convex/**'],
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
