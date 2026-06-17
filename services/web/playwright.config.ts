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
    timeout: 120_000,
  },
});
