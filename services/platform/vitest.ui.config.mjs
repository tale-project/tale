import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    pool: 'threads',
    setupFiles: ['./test/setup-ui.ts'],
    include: [
      'app/components/**/*.test.{ts,tsx}',
      'app/hooks/**/*.test.{ts,tsx}',
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
