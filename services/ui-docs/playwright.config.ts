import { fileURLToPath } from 'node:url';

import { createPlaywrightConfig } from '@tale/e2e/config';

/**
 * Smoke e2e for the design-system documentation site. Boots the service's own
 * dev server via the `dev` script, which builds the content artifacts (the
 * frontmatter manifest and the search index) before Vite starts — so the
 * search palette and every page body are exercisable. House defaults come from
 * `@tale/e2e/config`.
 *
 * `UI_DOCS_E2E_PORT` moves the server off 3003 — needed whenever another
 * checkout or a running `bun run dev` already serves the site there, which
 * would otherwise be silently reused (`reuseExistingServer` outside CI) and
 * test the wrong tree. The port reaches Vite through `UI_DOCS_PORT`
 * (`vite.config.ts` `server.port`); `--strictPort` makes a squatted port fail
 * loudly instead of drifting to the next free one.
 */

const PORT = Number(process.env.UI_DOCS_E2E_PORT ?? 3003);

export default createPlaywrightConfig({
  testDir: fileURLToPath(new URL('./tests/e2e', import.meta.url)),
  port: PORT,
  webServer: {
    command: `bun --bun scripts/build-content.ts && bun --bun vite --strictPort`,
    url: `http://localhost:${PORT}`,
    env: { UI_DOCS_PORT: String(PORT) },
    // Locally reuse an already-running `bun run dev`; in CI boot fresh.
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    // Generous: the command builds the content artifacts, and a cold Vite dev
    // start has to optimize the dependency graph before it answers.
    timeout: 240_000,
  },
});
