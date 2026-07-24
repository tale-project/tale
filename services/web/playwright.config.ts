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
    command: 'bun run dev',
    url: `http://localhost:${PORT}`,
    // Locally reuse an already-running `bun run dev`; in CI boot fresh.
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    // 240s, matching docs — its config records the same "CI runners can stall
    // on a cold Vite start" experience. This suite spent two days red on that
    // stall: on every run the dev server resolved its config in ~5s and then
    // went silent past the old 120s ceiling, with no banner and no error (Vite
    // awaits the deps optimizer before it listens, and the optimizer crawls the
    // i18n catalogs this branch moved to YAML). The mechanism was never pinned
    // down — it stopped reproducing after `messages/*.yml` was edited again —
    // so the budget stays generous. If it returns, serve a production build via
    // `vite preview` here, the way the platform suite already does in CI.
    timeout: 240_000,
  },
});
