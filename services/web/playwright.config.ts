import { fileURLToPath } from 'node:url';

import { createPlaywrightConfig } from '@tale/e2e/config';

/**
 * Smoke e2e for the marketing site (port 3001) — no auth, no backend, no
 * mock-LLM, so the config is just the shared factory plus a webServer. House
 * defaults (locale/UTC, reporters, retries) come from `@tale/e2e/config`.
 * CI previews the complete production build; ordinary local runs build the
 * client here or reuse a running `bun run dev`. Normal interactive specs
 * observe the client commit through their test-only startup snapshot helper.
 */

const PORT = 3001;

export default createPlaywrightConfig({
  testDir: fileURLToPath(new URL('./tests/e2e', import.meta.url)),
  port: PORT,
  webServer: {
    // Built assets + static preview, NOT `bun run dev`: the dev server's
    // cold start stalled past the 240s ceiling repeatedly in CI (config
    // resolved in ~5s, then silence with no banner and no error — Vite awaits
    // the deps optimizer before it listens, and the optimizer crawls the YAML
    // i18n catalogs). `vite preview` serves prebuilt assets with no optimizer
    // at all, the same cure the platform suite ships as TALE_E2E_SERVE_BUILD.
    // CI restores/builds the complete site through Turbo before this server,
    // also for SEO. The opt-in requires that output; ordinary local runs use
    // a client-only build, without networked release fetching in this budget.
    command:
      (process.env.E2E_USE_BUILD === '1'
        ? ''
        : 'bun --bun ../../packages/ui/bin/build-client.ts && ') +
      `bun --bun vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Locally reuse an already-running `bun run dev`; in CI boot fresh.
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    // Generous: the command builds before it can listen.
    timeout: 240_000,
  },
});
