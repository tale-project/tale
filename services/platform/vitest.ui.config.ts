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
    poolOptions: {
      threads: {
        maxThreads: 4,
      },
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
