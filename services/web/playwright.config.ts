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
    // banner on the same runner). Vite awaits the deps optimizer before it
    // listens, so DEBUG names which step stalls.
    command: 'DEBUG=vite:config,vite:deps,vite:resolve bun run dev',
    url: `http://localhost:${PORT}`,
    // Locally reuse an already-running `bun run dev`; in CI boot fresh.
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
});
