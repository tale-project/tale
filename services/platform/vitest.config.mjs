// ESM config to avoid CJS/ESM interop issues
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Use node by default, but run tests under convex/** in edge-runtime per convex-test docs
    environment: 'node',
    environmentMatchGlobs: [
      ['convex/**', 'edge-runtime'],
    ],
    server: { deps: { inline: ['convex-test'] } },
    include: ['**/*.test.{ts,tsx}'],
    exclude: [
      'node_modules',
      'dist',
      '**/*.config.{js,ts}',
      '**/.{idea,git,cache,output,temp}/**',
      'app/components/**/*.test.{ts,tsx}',
      'convex/workflow_engine/helpers/validation/validate_predefined_workflows.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});

