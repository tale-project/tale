import { defineConfig } from 'vitest/config';

// The real-browser lane: launches headless Camoufox through local test
// proxies. Opt in with `bun run test:camoufox` (it sets
// SESSION_MANAGER_CAMOUFOX_TESTS=1). The lane downloads nothing: its files
// skip unless CAMOUFOX_INSTALL_DIR points at an installed build (install one
// by hand into the git-ignored `.camoufox-tests/`, see the README). Some
// assertions are about timing (pictures per second while a page scrolls): run
// it with nothing heavy next to it.
export default defineConfig({
  test: {
    environment: 'node',
    // See vitest.config.ts: under Bun, zod must be inlined to keep its `z`.
    server: { deps: { inline: ['zod'] } },
    include: ['backend/**/*.camoufox.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 120_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
