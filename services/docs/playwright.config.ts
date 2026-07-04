import { fileURLToPath } from 'node:url';

import { createPlaywrightConfig } from '@tale/e2e/config';

/**
 * Smoke e2e for the documentation site. Boots the service's own dev server
 * (port 3002) via its `dev` script, which builds the search index before Vite
 * starts — so the search affordance is exercisable. House defaults come from
 * `@tale/e2e/config`.
 */

const PORT = 3002;

export default createPlaywrightConfig({
  testDir: fileURLToPath(new URL('./tests/e2e', import.meta.url)),
  port: PORT,
  webServer: {
    command: 'bun run dev',
    url: `http://localhost:${PORT}`,
    // Locally reuse an already-running `bun run dev`; in CI boot fresh.
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    // Search-index build + Vite cold start (CI runners can stall post-index).
    timeout: 240_000,
  },
});
