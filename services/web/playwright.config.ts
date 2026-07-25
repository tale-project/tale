import { fileURLToPath } from 'node:url';

import { createPlaywrightConfig } from '@tale/e2e/config';

/**
 * Smoke e2e for the marketing site (port 3001) — no auth, no backend, no
 * mock-LLM, so the config is just the shared factory plus a webServer. House
 * defaults (locale/UTC, reporters, retries) come from `@tale/e2e/config`.
 * In CI the webServer serves a client-only production build via `vite
 * preview` (see the command comment); locally it reuses a running `bun run
 * dev`.
 */

const PORT = 3001;

export default createPlaywrightConfig({
  testDir: fileURLToPath(new URL('./tests/e2e', import.meta.url)),
  port: PORT,
  webServer: {
    // Client-only build + static preview, NOT `bun run dev`: the dev server's
    // cold start stalled past the 240s ceiling repeatedly in CI (config
    // resolved in ~5s, then silence with no banner and no error — Vite awaits
    // the deps optimizer before it listens, and the optimizer crawls the YAML
    // i18n catalogs). `vite preview` serves prebuilt assets with no optimizer
    // at all, the same cure the platform suite ships as TALE_E2E_SERVE_BUILD.
    // Deliberately NOT `bun run build`: SSR/prerender/SEO and the networked
    // fetch-releases step are not needed to serve the SPA the dev server
    // serves, and each adds a failure mode inside the webServer budget.
    command: `bun --bun vite build && bun --bun vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Locally reuse an already-running `bun run dev`; in CI boot fresh.
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    // Generous: the command builds before it can listen.
    timeout: 240_000,
  },
});
