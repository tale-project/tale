import { defineConfig } from 'vitest/config';

/**
 * Prerender SEO suite — runs against `dist/` after `bun run build`.
 * Excluded from the default vitest config; turbo task `test:prerender`
 * dependsOn build.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/prerender/**/*.test.ts'],
    passWithNoTests: false,
  },
});
