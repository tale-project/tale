import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPlaywrightConfig, devices } from '@tale/e2e/config';

/**
 * Full-app E2E suite (issue #179). Runs the platform smoke flows — auth
 * (login/logout/password/2FA), onboarding, chat (+ threads/search/prompts),
 * conversations, agents, projects & tasks, knowledge, settings, governance, and
 * workflows — against the real local stack: Hono backend + Vite, both
 * booted by the webServer entries below via `scripts/dev.ts`. See
 * `tests/e2e/README.md` for the per-spec breakdown.
 *
 * Shared house defaults (locale/UTC, reporters, retries, timeouts) come from
 * `@tale/e2e/config`; everything below is platform-specific: the hermetic
 * mock-LLM + dev-stack webServer, and the auth `setup` project the specs depend
 * on. The mostly-static `web`/`docs` suites reuse the same factory with a much
 * thinner config.
 *
 * Determinism: the stack is pointed at `tests/e2e/fixtures/config` (one agent, one
 * provider whose `baseUrl` is the OpenAPI-driven mock gateway in the
 * `lib/mocks` package), so chat assertions never depend on a live LLM. The
 * gateway serves the deterministic chat-completions override plus Prism-mocked
 * AI endpoints and third-party connector APIs (all offline). Set
 * `E2E_MOCK_LLM=0` to run the suite against an already-running dev stack with
 * real provider keys — canned-text assertions are skipped in that mode.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url));

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
// The mock gateway (lib/mocks) was retired with the
// provider stack and returns in the providers phase. Until then the
// hermetic mock boot is additionally gated on the entrypoint existing, so
// the suite can still run its non-AI subset instead of failing at webServer
// startup.
const useMockLlm =
  process.env.E2E_MOCK_LLM !== '0' &&
  fs.existsSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      'lib/mocks/start.ts',
    ),
  );

// Parallelism: each WORKER mints its own isolated, fully-seeded org (see
// `tests/e2e/helpers/fixtures.ts`), so specs no longer share one backend account and
// can run concurrently. Workers are capped per shard to bound load on the
// single shared backend; CI fans the suite across runners with
// `--shard`, so each shard boots its own stack and runs this many workers.
const workers = process.env.E2E_WORKERS
  ? Number(process.env.E2E_WORKERS)
  : process.env.CI
    ? 3
    : 4;

// Fixed port — must match the provider fixture's `baseUrl`
// (`tests/e2e/fixtures/config/default/providers/e2e-mock.json`), which is loaded
// verbatim and cannot interpolate env. The `lib/mocks` gateway defaults to
// this port (`MOCKS_PORT`); keep the three in sync.
const MOCK_LLM_PORT = 4141;

// Hermetic app-DB credentials. CI's platform Playwright job starts a
// postgres:16 service with these same values (see `.github/workflows/e2e.yml`);
// the password is the throwaway already in `.env.test`. Playwright's
// `webServer.env` overlays process.env — set both keys so `deriveDevSecrets`
// (DATABASE_URL only when DB_PASSWORD is present) and backend `loadEnv`
// (DATABASE_URL required) succeed when the job env is missing.
// nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret
const E2E_DB_PASSWORD = process.env.DB_PASSWORD ?? 'test_password_e2e';
const E2E_DATABASE_URL =
  process.env.DATABASE_URL ??
  `postgresql://tale:${encodeURIComponent(E2E_DB_PASSWORD)}@127.0.0.1:5432/tale_app`;

export default createPlaywrightConfig({
  testDir: path.join(dirname, 'tests/e2e'),
  port: 3000,
  baseURL,
  // Vitest owns `*.test.ts` / `*.browser.test.ts`; Playwright owns
  // `tests/e2e/**/*.spec.ts` plus the auth setup project.
  testMatch: ['specs/**/*.spec.ts'],
  // Each test in a worker authenticates as that worker's owner via the
  // worker-scoped `org` fixture (which overrides `storageState`); specs that
  // need no auth import the base `@playwright/test` with an empty storageState.
  // So the project sets no static storageState and depends on no setup project.
  fullyParallel: true,
  workers,
  projects: [
    {
      name: 'chromium',
      testMatch: 'specs/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    // The mock LLM is only needed in the default (hermetic) mode. With
    // `E2E_MOCK_LLM=0` the suite targets a real stack with live provider keys,
    // so booting the mock would only risk a port conflict and waste startup.
    ...(useMockLlm
      ? [
          {
            // OpenAPI-driven mock gateway (lib/mocks): the deterministic
            // chat-completions override + Prism-mocked AI endpoints and
            // third-party connector APIs, all offline.
            command: 'bun lib/mocks/start.ts',
            url: `http://127.0.0.1:${MOCK_LLM_PORT}/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
          },
        ]
      : []),
    {
      command: 'bun scripts/dev.ts',
      url: baseURL,
      // Surface the orchestrator's boot progress (READY banner) — the only
      // way to diagnose a webServer timeout in CI.
      stdout: 'pipe',
      // Locally, reuse an already-running dev stack (`bun run dev`) instead of
      // failing on the taken port — note that a reused stack keeps ITS config
      // dir and provider keys, so run with E2E_MOCK_LLM=0 in that setup.
      reuseExistingServer: !process.env.CI,
      // Backend boot migrations + Vite preview dominate cold boot.
      timeout: 300_000,
      env: {
        // Skip compose (sandbox/gateway/knowledge-db/object-store). E2E CI
        // has no built images for those; their bootstraps are also non-fatal.
        // App Postgres is provided separately — CI's `e2e` job starts a
        // postgres:16 service, and DATABASE_URL below points the Hono backend
        // at it. Do not pass DB_PASSWORD: deriveDevSecrets would then mint
        // KNOWLEDGE_DATABASE_URL on :5433 (knowledge-db), which is not
        // running here. Keep this skip in both mock and live-stack modes.
        TALE_DEV_SKIP_DOCKER: '1',
        // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret
        DATABASE_URL: E2E_DATABASE_URL,
        // Same E2E marker CI exports at the workflow level: skips the
        // video-toolchain apt install in scripts/dev.ts (a slow mirror has
        // burned the webServer boot budget). Only applies when Playwright
        // boots the stack itself — a reused stack keeps its own env.
        TALE_E2E: '1',
        // Never pop a browser when the orchestrator is the e2e webServer — a
        // local (non-CI) `bun test:e2e` that spawns the stack would otherwise
        // steal focus on every run. The READY banner still prints the URL.
        TALE_DEV_OPEN: '0',
        // Deterministic 32-byte (hex) key so the hermetic stack can encrypt
        // secret-box values (project secrets, guardrails) — without it
        // `convex/lib/secret_box.ts` throws and secret-create flows fail. A
        // fixed throwaway test key, never a real secret (mirrors the
        // TALE_PROVIDER_KEY_E2E_MOCK pattern below); synced into the deployment
        // by scripts/sync-convex-env-from-dotenv.ts via the process-env fallback.
        // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret
        ENCRYPTION_SECRET_HEX:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        // `tests/manual/SETUP.md` §1A's mode-A command block mirrors this exact
        // env set (TALE_CONFIG_DIR, TALE_CONFIG_BUILTIN_DIR, TALE_PROVIDER_KEY_
        // E2E_MOCK, TALE_ALLOW_PRIVATE_PROVIDER_HOSTS, TALE_MOCK_CONNECTORS_
        // BASE) for AI/manual testers — when you change a value or add/remove a
        // var here, update that doc in the same change (#2633 was a drift here).
        ...(useMockLlm
          ? {
              // Hermetic config dir: seeds every new org with the single E2E
              // agent + the mock provider + the trivial `test` workflow.
              TALE_CONFIG_DIR: path.join(dirname, 'tests/e2e/fixtures/config'),
              // Pin the built-in catalog to the fixture's domain-root so the
              // dev default (repo/builtin-configs) can't leak the real catalog
              // into hermetic test orgs. The seeder reads <builtin>/<domain>;
              // the fixture is org-shaped, so point at its `default/` org dir.
              TALE_CONFIG_BUILTIN_DIR: path.join(
                dirname,
                'tests/e2e/fixtures/config/default',
              ),
              // Resolved by the fixture provider's `secretsEnv`; pushed into
              // the Convex deployment env by
              // scripts/sync-convex-env-from-dotenv.ts (TALE_PROVIDER_KEY_*
              // passthrough).
              TALE_PROVIDER_KEY_E2E_MOCK: 'tale-e2e-mock-key',
              // The mock gateway lives on 127.0.0.1, which the provider host
              // policy blocks by default (SSRF defence) — opt in for the E2E
              // stack. Also authorizes the loopback connector-mock host.
              TALE_ALLOW_PRIVATE_PROVIDER_HOSTS: '1',
              // Redirect third-party connector calls (Slack/GitHub/
              // …) to the mock gateway so connector flows run offline too.
              // Consumed by the sandbox URL rewrite (`mock_rewrite.ts`).
              TALE_MOCK_CONNECTORS_BASE: `http://127.0.0.1:${MOCK_LLM_PORT}`,
            }
          : {}),
      },
    },
  ],
});
