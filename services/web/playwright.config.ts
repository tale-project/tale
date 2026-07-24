import { fileURLToPath } from 'node:url';

import { createPlaywrightConfig } from '@tale/e2e/config';

/**
 * Smoke e2e for the marketing site. Boots the service's own dev server (port
 * 3001) via its `dev` script — no auth, no backend, no mock-LLM, so the config
 * is just the shared factory plus a webServer. House defaults (locale/UTC,
 * reporters, retries) come from `@tale/e2e/config`.
 */

const PORT = 3001;

export default createPlaywrightConfig({
  testDir: fileURLToPath(new URL('./tests/e2e', import.meta.url)),
  port: PORT,
  webServer: {
    // TEMPORARY (revert once the CI-only startup stall is identified): the dev
    // server never reaches `listen` on GitHub runners — no banner, no error,
    // just the 120s webServer timeout — while the same command, lockfile, cold
    // cache and CI=true boot in ~1s locally (and the docs job's Vite prints its
    // banner on the same runner). Round 1 narrowed it: config resolves in ~5s,
    // then 119s of total silence — no vite:deps, no vite:resolve, no banner. So
    // widen to every namespace to name the subsystem that stalls after
    // resolveConfig.
    command: 'DEBUG=vite:* bun run dev',
    url: `http://localhost:${PORT}`,
    // Locally reuse an already-running `bun run dev`; in CI boot fresh.
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    // Matches docs, whose config already records that "CI runners can stall
    // post-index" on a cold Vite start.
    timeout: 240_000,
  },
});
