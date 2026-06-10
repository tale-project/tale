import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

/**
 * Full-app E2E suite (issue #179). Runs the four v1 smoke flows (login, chat
 * send + stream, governance settings save, automation run) against the real
 * local stack: anonymous Convex backend + Vite, both booted by the webServer
 * entries below via `scripts/dev.ts`.
 *
 * Determinism: the stack is pointed at `e2e/fixtures/config` (one agent, one
 * provider whose `baseUrl` is the mock OpenAI-compatible SSE server in
 * `e2e/mock-llm/server.ts`), so chat assertions never depend on a live LLM.
 * Set `E2E_MOCK_LLM=0` to run the suite against an already-running dev stack
 * with real provider keys — canned-text assertions are skipped in that mode.
 *
 * See `e2e/README.md` for how to run and extend the suite.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url));

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const mockLlmPort = Number(process.env.E2E_MOCK_LLM_PORT ?? '4141');
const useMockLlm = process.env.E2E_MOCK_LLM !== '0';

export default defineConfig({
  testDir: './e2e',
  // Vitest owns `*.test.ts` / `*.browser.test.ts`; Playwright owns
  // `e2e/**/*.spec.ts` plus the auth setup project.
  testMatch: ['setup/**/*.setup.ts', 'specs/**/*.spec.ts'],
  outputDir: './test-results',
  // One worker: the specs share a single backend (one owner account/org) and
  // the chat/automation flows mutate org state. Revisit sharding when the
  // suite outgrows a handful of specs.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  forbidOnly: !!process.env.CI,
  // Cold Vite dev-server compiles on first navigation are slow; keep per-test
  // budgets generous rather than flaky.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Pin the browser locale so i18n-derived locators resolve against
    // `messages/en.json` (the app follows the browser language).
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [
    {
      name: 'setup',
      testMatch: 'setup/**/*.setup.ts',
    },
    {
      name: 'chromium',
      testMatch: 'specs/**/*.spec.ts',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(dirname, 'e2e/.auth/owner.json'),
      },
    },
  ],
  webServer: [
    {
      command: 'bun e2e/mock-llm/server.ts',
      url: `http://127.0.0.1:${mockLlmPort}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        E2E_MOCK_LLM_PORT: String(mockLlmPort),
      },
    },
    {
      command: 'bun scripts/dev.ts',
      url: baseURL,
      // Surface the orchestrator's boot progress (Convex pre-warm, READY
      // banner) — the only way to diagnose a webServer timeout in CI.
      stdout: 'pipe',
      // Locally, reuse an already-running dev stack (`bun run dev`) instead of
      // failing on the taken port — note that a reused stack keeps ITS config
      // dir and provider keys, so run with E2E_MOCK_LLM=0 in that setup.
      reuseExistingServer: !process.env.CI,
      // Convex pre-warm (binary download + function push) dominates cold boot.
      timeout: 300_000,
      env: useMockLlm
        ? {
            // Hermetic config dir: seeds every new org with the single E2E
            // agent + the mock provider + the trivial `test` workflow.
            TALE_CONFIG_DIR: path.join(dirname, 'e2e/fixtures/config'),
            // Resolved by the fixture provider's `secretsEnv`; pushed into the
            // Convex deployment env by scripts/sync-convex-env-from-dotenv.ts
            // (TALE_PROVIDER_KEY_* passthrough).
            TALE_PROVIDER_KEY_E2E_MOCK: 'tale-e2e-mock-key',
            // The mock LLM lives on 127.0.0.1, which the provider host policy
            // blocks by default (SSRF defence) — opt in for the E2E stack.
            TALE_ALLOW_PRIVATE_PROVIDER_HOSTS: '1',
          }
        : {},
    },
  ],
});
