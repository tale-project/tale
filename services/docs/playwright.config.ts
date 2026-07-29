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
    // Search index + client-only build + static preview, NOT `bun run dev`:
    // cold Vite dev starts stall past the budget on CI runners (same class
    // the web suite hit — the deps optimizer never finishes; `vite preview`
    // has no optimizer). SSR/prerender/SEO stay out of the command — the
    // suite exercises the SPA the dev server serves.
    command:
      `bun --bun scripts/build-search-index.ts && ` +
      `bun --bun vite build && bun --bun vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Locally reuse an already-running `bun run dev`; in CI boot fresh.
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    // Generous: the command builds the search index and the bundle first.
    timeout: 240_000,
  },
});
