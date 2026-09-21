import { yamlImports } from '@tale/ui/vite/yaml';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [viteReact(), yamlImports()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'tests/e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
    },
  },
});
